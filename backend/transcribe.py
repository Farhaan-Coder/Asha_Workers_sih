"""
Speech-to-text transcription with diarization — adapted from MOM-generator
(https://github.com/Ishant5436/MOM-generator)'s backend/transcribe.py for
Sukanya's ASHA home-visit use case.

Two changes from the source project, both because Sukanya needs the
original-language transcript (evidence for extraction.py's keyword
matching, danger-sign quotes for the anti-hallucination contract) rather
than an English meeting summary:
  1. Whisper backends run with task="transcribe", not MOM-generator's
     task="translate" (which forces English output).
  2. The meeting-specific initial_prompt is replaced with a clinical-visit
     one.

Language is auto-detected (language=None), not forced to Hindi. This was a
real bug found in testing: forcing language="hi" on non-Hindi audio doesn't
just mistranslate — Whisper decodes the audio as if every phoneme belongs to
Hindi's phonology, producing fully-formed but completely wrong Hindi text
with no indication anything went wrong ("The patient's blood pressure is
155..." in English became meaningless Hindi word-salad under language="hi";
the same clip auto-detected correctly as English and transcribed perfectly).
India's ASHA/patient conversations are frequently in a regional language
other than Hindi, or code-switch between Hindi and English — auto-detect
picks the dominant language actually spoken instead of assuming Hindi.

Order of preference (first one that's actually installed/configured wins;
none of them are required — see `transcribe()`'s final fallback). Gemini
native audio runs first now (was Whisper-first, then Gemini-as-fallback,
in an earlier version of this file) — once a valid GEMINI_API_KEY is
configured it is the primary engine; Whisper backends are the fallback for
when no key is set or the Gemini call raises (rate limit, network, revoked
key), not the other way around. Google Cloud Speech is tried last because
its wrapper below can only target one language family per call (see
`_try_google_cloud_speech`) and is therefore the weakest option for a
multilingual ASHA conversation:
  1. Gemini native audio (needs GEMINI_API_KEY)
  2. mlx-whisper (Apple Silicon GPU-native — local fallback on this machine)
  3. faster-whisper (CPU, works anywhere)
  4. OpenAI hosted Whisper API (needs OPENAI_API_KEY)
  5. Google Cloud Speech (needs GOOGLE_APPLICATION_CREDENTIALS)
  6. None available -> raise, with a message pointing at the UI's
     "Text/Script" paste tab (shared/sakhi-record.js already has one) as the
     always-available path.
Note the trade-off this order accepts: Gemini needs network + a valid API
key and costs money per call, where mlx-whisper is local/free/offline-
capable. Kept the Whisper backends in the chain rather than deleting them
so the app still works (degraded to local transcription) if the key is
ever unset, revoked, or the network is down during a home visit — same
reasoning as every other fallback in this chain.

Language coverage note (en/hi/mr/bn, the four languages this ASHA app must
support): tested empirically against synthesized Hindi and Bengali clips.
Hindi transcribes reliably on every Whisper size tried (turbo and medium).
Bengali is unreliable on-device — both mlx-whisper's turbo and medium
checkpoints produced garbled, wrong-script output on synthesized Bengali
speech (turbo hallucinated Gujarati-looking text, medium hallucinated
Telugu-looking text.  This may be a weakness specific to the synthetic
TTS voice used to generate the test clip rather than real speech — it
was not verified against a real Bengali speaker). Whisper's own
`task="translate"` was evaluated as a way to get English directly out of
non-English audio in a single pass: mlx-whisper's `turbo` checkpoint does
NOT support it at all (identical output for task="transcribe" and
task="translate" — the distilled turbo model dropped translation), while
`medium` does. Rather than special-case the model choice per task (and
lose turbo's speed for the common transcribe-only path), translation to
English is handled as a separate TEXT step after transcription — see
`translate_util.py` — decoupling "which Whisper checkpoint is loaded" from
"do we need an English version for extraction.py".

Returns transcript text interleaved with speaker labels when diarization
succeeds ("Speaker 1: ...\\n\\nSpeaker 2: ..."), otherwise plain paragraphs.

Noise handling (`_denoise_for_stt`): a home visit is rarely recorded in a
silent room — background TV, other family members, traffic. Empirically
tested against a synthesized clean clip vs the same clip with pink noise
mixed in at two levels: background noise measurably corrupts specific
number readings (a systolic BP reading became a different, wrong number
under noise, in a way no amount of filter tuning recovered — once noise has
masked a peak, it can't be un-masked after the fact). What DOES help,
verified empirically rather than assumed: a conservative filter chain
(highpass to cut sub-speech rumble, a gentle FFT denoiser, dynamic
normalization to lift quiet speech) recovered at least one field (a spoken
temperature) from word-garbled to correctly digit-extractable under noise,
with ZERO regression on already-clean audio in either language tested. An
earlier, more aggressive denoiser setting was tried and rejected: it
silently corrupted a correct digit-form number ("172" -> "108") on audio
that had no added noise at all — a real regression, not hypothetical, is
why the parameters below are deliberately conservative rather than tuned
for maximum noise reduction. This is a genuine improvement, not a fix for
every noisy recording: heavy noise that has already destroyed a specific
word's acoustic signature stays lost. The existing silence/hallucination
gate (`_check_has_audio_content`) intentionally runs on the audio BEFORE
denoising, not after — denoising's normalization step measurably raises
the peak level of pure background noise with no speech in it too, which
would otherwise let more no-speech clips slip past that gate.

Background VOICES, not just noise (`_drop_distant_background_voice`): a
different failure mode from the above — a second person (family member,
TV dialogue) speaking a clean, grammatically normal sentence during a pause
in the ASHA/patient conversation. Whisper transcribes it accurately and
confidently (normal avg_logprob/no_speech_prob/compression_ratio — nothing
about it looks wrong, because acoustically it isn't), and it ends up
spliced into the transcript as if it were part of the clinical
conversation. No confidence signal distinguishes this; empirically, the
only thing that reliably does is proximity — the ASHA worker's phone is
near the conversation and far from someone else in the room, so that
person's speech peaks measurably quieter. Segments whose peak volume is a
large outlier (>=12dB quieter than the loudest segment in the same
recording, calibrated against a synthesized background-speaker test vs. a
synthesized quiet-but-real-patient test) are dropped. This has a real,
inherent limit worth stating plainly: a second voice at genuinely the same
volume as the primary speakers is indistinguishable from them by this (or
any purely acoustic-energy) method — that needs true speaker diarization,
which this app deliberately doesn't install by default (see
`diarization.py`'s docstring).
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time

TEXT_EXTS = {".txt", ".md", ".vtt", ".srt"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".webm", ".mpeg", ".mpga", ".aac", ".acc"}
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".m4v", ".avi", ".webm"}
MEDIA_EXTS = AUDIO_EXTS | VIDEO_EXTS

# The five languages this app explicitly supports end-to-end (STT language
# hint, Gemini's recognized-language set, Google Cloud Speech's locale map,
# and extraction.py's translate-before-extract path for anything non-en/hi).
_LANG_NAMES = {"en": "English", "hi": "Hindi", "mr": "Marathi", "bn": "Bengali", "ta": "Tamil"}

_INITIAL_PROMPT = (
    "This is a conversation between an ASHA health worker and a patient during a home "
    "visit, in Hindi, English, or a regional Indian language, possibly mixing languages. "
    "It may include vital signs (BP, weight, temperature), symptoms, and clinical terms. "
    "Preserve numbers exactly as spoken."
)
# Deliberately does not assert "Hindi or Hinglish" the way an earlier version did —
# that wording plus language="hi" forced every clip through Hindi decoding
# regardless of what was actually spoken (see module docstring). The prompt
# only biases *content* expectations (clinical domain, numbers); the actual
# language comes from Whisper's own detection, not from this text.

# Below this peak level, treat the clip as having no real speech in it.
# Measured empirically (see transcribe.py commit history / PR notes): real
# recorded speech peaks around -2 to -20 dB even at a normal conversational
# distance from the mic; pure digital silence measures -91 dB; low-level
# background noise with no speech measures around -60 dB. -45 dB sits well
# between "quiet room tone" and "someone actually spoke."
_MIN_PEAK_DB = -45.0


def _check_has_audio_content(file_path: str) -> None:
    """Raise RuntimeError if the clip has no audio louder than _MIN_PEAK_DB.

    Whisper-family models do not reliably say "there's no speech here" when
    fed silence or near-silence — confirmed empirically: on 4s of pure
    digital silence, mlx-whisper returned a fully-formed but meaningless
    multi-language sentence with a *low* no_speech_prob (its own confidence
    signal was wrong), and on a different run, a lone repeated word. Text-
    pattern-matching the output after the fact can't reliably catch every
    shape that hallucination takes. Checking the input's actual peak volume
    with ffmpeg (which every install of this app already has for format
    conversion) catches it before a single second of GPU/CPU time is spent,
    and is the same technique faster-whisper's own `vad_filter=True` is
    doing under the hood for its backend.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return  # no ffmpeg available — can't check, so don't block the call
    try:
        result = subprocess.run(
            [ffmpeg, "-i", file_path, "-af", "volumedetect", "-f", "null", "-"],
            capture_output=True, text=True, timeout=30,
        )
        match = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", result.stderr)
        if match and float(match.group(1)) < _MIN_PEAK_DB:
            raise RuntimeError(
                "No speech was detected in this recording (it appears to be silence or "
                "background noise only). Check the microphone is capturing audio, record "
                "closer to the speaker, or use the 'Text/Script' tab to paste the "
                "conversation instead."
            )
    except subprocess.TimeoutExpired:
        pass  # don't block transcription over a diagnostic check timing out


# highpass: cuts sub-speech rumble (traffic, handling noise) below where any
# spoken sound lives. afftdn at nr=6 (dB of reduction, default is 12) / nf=-30
# (assumed noise floor): deliberately gentle — nr=12 (ffmpeg's default) was
# tested and rejected because it corrupted a correctly-spoken digit-form
# number on audio that had NO added noise at all (see module docstring).
# dynaudnorm: lifts quiet speech relative to the peaks without hard-clipping.
# Order matters: highpass first (so afftdn's noise estimate isn't thrown off
# by rumble it doesn't need to touch), afftdn second, normalize last.
_DENOISE_FILTER = "highpass=f=80,afftdn=nr=6:nf=-30,dynaudnorm=f=150:g=15"


def _denoise_for_stt(file_path: str) -> tuple[str, bool]:
    """Returns (path_to_use, is_a_new_tempfile_the_caller_must_clean_up).

    Runs AFTER `_check_has_audio_content`, deliberately: dynaudnorm's
    normalization measurably raises the peak level of pure background noise
    that has no speech in it (verified: -35.8dB before, -25.5dB after, on a
    synthesized noise-only clip) — running the silence gate on already-
    denoised audio would let more true no-speech clips slip past it. Falls
    back to the original, undenoised path (not a raised error) if ffmpeg is
    missing or the filter fails, since denoising is a quality improvement,
    not a correctness requirement — every backend already works on raw
    audio."""
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return file_path, False
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    tmp.close()
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", file_path, "-af", _DENOISE_FILTER, "-ar", "16000", tmp.name],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
        )
        return tmp.name, True
    except Exception as e:
        print(f"[transcribe] denoise filter failed, using original audio: {e}")
        try:
            os.remove(tmp.name)
        except OSError:
            pass
        return file_path, False


# A segment this much quieter (peak dB) than the loudest segment in the same
# recording is treated as a different, more distant speaker rather than the
# near-field ASHA/patient conversation, and dropped. Empirically calibrated,
# not guessed: a second voice reading an unrelated, grammatically clean
# sentence (simulating a family member talking in the background) still gets
# transcribed accurately and confidently by Whisper — avg_logprob/
# no_speech_prob/compression_ratio all look completely normal for it, because
# acoustically it IS clear, correctly-recognized speech; those signals cannot
# tell "wrong speaker" from "right speaker" and this margin is the only
# signal in this pipeline that can. Measured on a synthesized test case: a
# background sentence mixed in at -15dB (simulating another room) measured
# ~15dB quieter (peak) than the surrounding primary-speaker segments and was
# correctly the only outlier; a genuinely soft-spoken patient reply at -8dB
# measured only ~8dB quieter than the same primary segments. 12dB sits
# between those two measured gaps with margin on both sides.
_BACKGROUND_VOICE_MARGIN_DB = 12.0


def _drop_distant_background_voice(segments: list, audio_path: str) -> list:
    """Drop segments whose peak volume is a clear outlier (quieter) relative
    to the rest of the recording -- see _BACKGROUND_VOICE_MARGIN_DB above for
    why this, not a confidence score, is what catches a background voice.
    Fails open: any segment whose volume can't be measured (ffmpeg missing,
    a too-short clip, a bad timestamp) is kept rather than dropped, since a
    measurement gap must never silently delete real clinical content. Needs
    at least 2 segments to have an "outlier" at all.
    """
    if len(segments) < 2:
        return segments
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return segments

    peaks = {}
    for i, seg in enumerate(segments):
        start, end = seg.get("start"), seg.get("end")
        if start is None or end is None or end - start < 0.15:
            continue
        try:
            result = subprocess.run(
                [ffmpeg, "-ss", str(start), "-t", str(end - start), "-i", audio_path,
                 "-af", "volumedetect", "-f", "null", "-"],
                capture_output=True, text=True, timeout=10,
            )
            match = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB", result.stderr)
            if match:
                peaks[i] = float(match.group(1))
        except (subprocess.TimeoutExpired, Exception):
            continue

    if len(peaks) < 2:
        return segments  # not enough measurements to call anything an outlier

    loudest = max(peaks.values())
    kept = []
    for i, seg in enumerate(segments):
        if i in peaks and loudest - peaks[i] >= _BACKGROUND_VOICE_MARGIN_DB:
            print(f"[transcribe] dropping likely background-voice segment "
                  f"[{seg.get('start')}-{seg.get('end')}] ({peaks[i]:.1f}dB vs "
                  f"{loudest:.1f}dB loudest): {seg.get('text', '')!r}")
            continue
        kept.append(seg)
    return kept or segments  # never return empty -- fail open


def transcribe(file_path: str, language: str | None = None) -> dict:
    """language: an explicit ISO-639-1 code ("hi", "en", "bn", "ta", "mr", ...)
    to force, or None/"auto" to let Whisper detect it from the audio itself
    (the default, and the right choice unless the caller already knows the
    speaker's language for certain).

    Returns {"text": <transcript str>, "language": <ISO-639-1 code the
    backend detected, or None if the backend doesn't report one (pasted
    text, Gemini, Google Cloud Speech)>}. Callers that need an English
    version for extraction (any of en/hi/mr/bn) should pass `text` through
    `translate_util.to_english(text, language)` — this function only
    transcribes/detects, it never translates.
    """
    if language == "auto":
        language = None
    ext = os.path.splitext(file_path)[1].lower()

    if ext in TEXT_EXTS:
        return {"text": _read_text(file_path, ext), "language": None}

    if ext not in MEDIA_EXTS:
        supported = ", ".join(sorted(TEXT_EXTS | MEDIA_EXTS))
        raise RuntimeError(f"Unsupported file type '{ext or 'unknown'}'. Upload one of: {supported}.")

    process_audio_path = file_path
    cleanup_audio = False

    if ext not in {".wav", ".mp3", ".flac"} or ext in VIDEO_EXTS:
        ffmpeg = shutil.which("ffmpeg")
        if ffmpeg:
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
            tmp.close()
            process_audio_path = tmp.name
            cleanup_audio = True
            try:
                subprocess.run(
                    [ffmpeg, "-y", "-i", file_path, "-vn", "-ac", "1", "-ar", "16000", process_audio_path],
                    check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
            except Exception as e:
                print(f"[transcribe] ffmpeg conversion failed: {e}")
                process_audio_path = file_path
                cleanup_audio = False

    stt_path = process_audio_path
    cleanup_denoised = False

    try:
        _check_has_audio_content(process_audio_path)
        stt_path, cleanup_denoised = _denoise_for_stt(process_audio_path)

        segments = None
        backend_used = None
        detected_language = None

        for backend_name, fn in (
            ("gemini", lambda p: _try_gemini_audio(p, language)),
            ("mlx_whisper", lambda p: _try_mlx_whisper(p, language)),
            ("faster_whisper", lambda p: _try_local_whisper(p, language)),
            ("openai_whisper", lambda p: _try_openai_whisper(p, language)),
            ("google_cloud_speech", lambda p: _try_google_cloud_speech(p, language)),
        ):
            result = fn(stt_path)
            if result is not None:
                segments, detected_language = result
                backend_used = backend_name
                break

        if segments is None:
            raise RuntimeError(
                "No transcription backend available (no mlx-whisper / faster-whisper installed, "
                "no OPENAI_API_KEY / GEMINI_API_KEY / GOOGLE_APPLICATION_CREDENTIALS set). "
                "Use the 'Text/Script' tab to paste the conversation instead."
            )

        if not segments:
            return {"text": "", "language": detected_language}

        # Whisper-family models don't reliably emit nothing on silence/near-
        # silence — a known failure mode is a lone punctuation token ("!",
        # ".", "...") per segment instead. Passing that through as if it were
        # a real transcript is worse than an honest failure: it silently
        # "succeeds" with garbage that then produces zero extracted fields
        # with no indication why. Drop segments with no actual word
        # characters (any script, not just Latin) and treat an all-garbage
        # result the same as "no transcription backend available" — the
        # frontend's error path is the same either way, and the message
        # tells the ASHA worker what to do about it.
        real_segments = [s for s in segments if re.search(r"\w", s.get("text", ""), flags=re.UNICODE)]
        if not real_segments:
            raise RuntimeError(
                "No speech was detected in this recording (only silence or non-speech noise). "
                "Try recording closer to the microphone, or use the 'Text/Script' tab to paste "
                "the conversation instead."
            )
        # Measured against process_audio_path (pre-denoise), not stt_path: the
        # denoise chain's dynaudnorm step (see _denoise_for_stt) exists to lift
        # quiet speech, which compresses exactly the loud/quiet gap this filter
        # depends on -- verified empirically, it shrank a real 15dB gap down to
        # ~4dB, under the detection margin. Timestamps line up on both since
        # denoising doesn't change duration/timing, only spectrum and level.
        segments = _drop_distant_background_voice(real_segments, process_audio_path)

        try:
            from diarization import DiarizationEngine
            diarizer = DiarizationEngine()
            segments = diarizer.diarize(process_audio_path, segments)
        except Exception as e:
            print(f"[transcribe] Diarization unavailable/failed, continuing without speakers: {e}")

        lines = []
        current_speaker = None
        current_text = []
        has_custom_speakers = False
        for seg in segments:
            speaker = seg.get("speaker", "Speaker")
            if speaker and speaker != "Speaker":
                has_custom_speakers = True
            text = seg.get("text", "").strip()
            if not text:
                continue
            if speaker != current_speaker:
                if current_speaker is not None:
                    lines.append(f"{current_speaker}: {' '.join(current_text)}")
                current_speaker = speaker
                current_text = [text]
            else:
                current_text.append(text)
        if current_speaker is not None and current_text:
            lines.append(f"{current_speaker}: {' '.join(current_text)}")

        raw_result = "\n\n".join(lines) if lines else "\n".join(s.get("text", "") for s in segments)
        
        # If diarization was unavailable (all segments default to 'Speaker'), apply conversational dialogue turn formatting
        if not has_custom_speakers and raw_result:
            clean_text = re.sub(r"^Speaker:\s*", "", raw_result, flags=re.MULTILINE)
            return {"text": format_dialogue_turns(clean_text), "language": detected_language}

        return {"text": raw_result, "language": detected_language}

    finally:
        if cleanup_denoised and stt_path != process_audio_path and os.path.exists(stt_path):
            os.remove(stt_path)
        if cleanup_audio and os.path.exists(process_audio_path):
            os.remove(process_audio_path)


def format_dialogue_turns(text: str, segments: list = None) -> str:
    """Format an un-diarized or single-speaker transcript into clean ASHA and Patient dialogues."""
    if not text:
        return ""
    
    # If speaker labels already exist in text, return as-is
    if re.search(r"^(?:ASHA|Patient|Mother|Doctor|Worker|Speaker\s*\d+):", text, re.MULTILINE | re.IGNORECASE):
        return text

    # Split into sentences (preserving sentence delimiters)
    sentences = re.split(r"([।\n.?!]+)", text)
    chunks = []
    for i in range(0, len(sentences) - 1, 2):
        s = (sentences[i] + sentences[i + 1]).strip()
        if s:
            chunks.append(s)
    if len(sentences) % 2 == 1 and sentences[-1].strip():
        chunks.append(sentences[-1].strip())
        
    if not chunks:
        chunks = [text.strip()]

    # Heuristic conversational turn-taking markers
    asha_markers = [
        "नमस्ते", "hello", "hi", "कैसी हैं", "कैसे हैं", "बीपी", "वजन", "तापमान", "चेक करती", "चेक करते",
        "दवा", "गोली", "हफ्ते", "महीने", "टीका", "अस्पताल", "phc", "जाना होगा", "आराम", "खुराक",
        "how are you", "let me check", "blood pressure", "temperature", "advised", "take rest"
    ]
    patient_markers = [
        "दीदी", "हाँ दीदी", "सिरदर्द", "चक्कर", "दर्द", "उल्टी", "बुखार", "धुंधला", "सूजन", "खून",
        "तकलीफ", "क्या करें", "कमजोरी", "सोता रहता", "दस्त", "yes didi", "headache", "fever", "pain",
        "bleeding", "vomiting", "weakness"
    ]

    dialogue_lines = []
    current_role = "ASHA"
    current_sentences = []

    for chunk in chunks:
        c_lower = chunk.lower()
        has_asha = any(k in c_lower for k in asha_markers)
        has_pat = any(k in c_lower for k in patient_markers)

        # Decide role based on context
        new_role = current_role
        if has_pat and not has_asha:
            new_role = "Patient"
        elif has_asha and not has_pat:
            new_role = "ASHA"
        elif "?" in chunk or "क्या" in chunk:
            new_role = "ASHA" if current_role == "Patient" else "Patient"

        if new_role != current_role and current_sentences:
            dialogue_lines.append(f"{current_role}: {' '.join(current_sentences)}")
            current_sentences = [chunk]
            current_role = new_role
        else:
            current_sentences.append(chunk)

    if current_sentences:
        dialogue_lines.append(f"{current_role}: {' '.join(current_sentences)}")

    return "\n\n".join(dialogue_lines) if dialogue_lines else text


def _read_text(path: str, ext: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        raw = f.read()
    if ext in {".vtt", ".srt"}:
        lines = []
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.isdigit() or "-->" in line or line.upper() == "WEBVTT":
                continue
            lines.append(line)
        return " ".join(lines)
    return raw


def _try_google_cloud_speech(file_path: str, language: str | None = None):
    """Google Cloud Speech's synchronous `recognize()` needs ONE primary
    language per call (`alternative_language_codes` accepts up to 3 more as
    best-effort hints, not a true auto-detect). Previously hardcoded to
    "hi-IN" regardless of `language` — meaning if GOOGLE_APPLICATION_CREDENTIALS
    were ever configured, this backend would force every clip through Hindi
    decoding the same way the language="hi" bug did at the Whisper layer.
    Now honors the requested language (defaulting to en-IN, with the other
    three supported languages offered as alternatives when auto-detecting)."""
    if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        return None
    try:
        from google.cloud import speech
        import wave
        from concurrent.futures import ThreadPoolExecutor

        _LANG_CODES = {"en": "en-IN", "hi": "hi-IN", "mr": "mr-IN", "bn": "bn-IN"}
        primary = _LANG_CODES.get(language, "en-IN")
        alternatives = [c for c in _LANG_CODES.values() if c != primary]

        client = speech.SpeechClient()
        FRAMES_PER_CHUNK = 55 * 16000
        chunks = []
        with wave.open(file_path, "rb") as wf:
            if wf.getframerate() != 16000 or wf.getnchannels() != 1:
                return None
            while True:
                frames = wf.readframes(FRAMES_PER_CHUNK)
                if not frames:
                    break
                chunks.append(frames)

        def recognize_chunk(chunk_bytes):
            audio = speech.RecognitionAudio(content=chunk_bytes)
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000, language_code=primary,
                alternative_language_codes=alternatives if not language else None,
                enable_automatic_punctuation=True, enable_word_time_offsets=True,
            )
            return client.recognize(config=config, audio=audio)

        segments = []
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(recognize_chunk, chunks))
        for idx, response in enumerate(results):
            time_offset = idx * 55.0
            for result in response.results:
                alt = result.alternatives[0]
                segments.append({"start": time_offset, "end": time_offset + 55.0, "text": alt.transcript})
        return (segments, language) if segments else None
    except Exception as e:
        print(f"[transcribe] Google Cloud Speech failed: {e}")
        return None


# Set when a call hits Gemini's rate/quota limit (free tier: 20 requests/day
# for gemini-2.5-flash, confirmed hitting this in testing) -- a monotonic
# timestamp before which _try_gemini_audio skips the network call entirely
# rather than repeating a call known to fail. Without this, every
# transcription after the quota is hit still pays the full ~6s round trip to
# be told "no" before falling back to Whisper -- that wasted 6s per request,
# compounding across a day's use, is a real and avoidable chunk of "why is
# transcribing suddenly so slow."
_gemini_cooldown_until = 0.0


def _try_gemini_audio(file_path: str, language: str | None = None):
    global _gemini_cooldown_until
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    if time.monotonic() < _gemini_cooldown_until:
        return None  # known rate-limited; skip straight to the next backend
    try:
        from google import genai
        from google.genai import types
        import json

        client = genai.Client(api_key=api_key)
        uploaded_file = client.files.upload(file=file_path)
        try:
            lang_line = (
                f"The speaker has confirmed they are speaking {_LANG_NAMES.get(language, language)} "
                f"-- transcribe in that language; do not switch languages even if a few words sound "
                f"like another language (treat those as accented/code-switched speech, not a language "
                f"change)."
                if language else
                "Detect which language is being spoken from English, Hindi, Marathi, Bengali, or Tamil "
                "(possibly code-switched/mixed) and transcribe in that language."
            )
            prompt = (
                f"Transcribe this audio file exactly word-for-word in its ORIGINAL language. "
                f"{lang_line} Do NOT "
                "translate. This is a conversation between an ASHA health worker and a "
                "patient during a home visit; it may include vital signs (blood pressure, "
                "weight, temperature), symptoms, and clinical terms. Preserve every number "
                "exactly as spoken (do not round, convert units, or write words as digits or "
                "vice versa) — these numbers are read back into a clinical record. Split "
                "'segments' by natural pause/turn boundaries, and give each an accurate "
                "'start'/'end' time in seconds; a downstream step uses those timestamps to "
                "tell apart the near-field speaker from anyone else audible in the "
                "background, so timestamp accuracy matters as much as the words. "
                "Output ONLY a valid JSON object with a 'language' field (the "
                "ISO-639-1 code of the language actually spoken: 'en', 'hi', 'mr', 'bn', or 'ta') "
                "and a 'segments' field: an array of objects with 'start' (float seconds), "
                "'end' (float seconds), and 'text' (string)."
            )
            response = client.models.generate_content(
                model="gemini-2.5-flash", contents=[uploaded_file, prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.0),
            )
            data = json.loads(response.text)
            raw_segments = data.get("segments", data if isinstance(data, list) else [])
            segments = [
                {"start": float(item.get("start", 0.0)), "end": float(item.get("end", 0.0)), "text": str(item.get("text", ""))}
                for item in raw_segments
            ]
            return (segments, data.get("language") if isinstance(data, dict) else None) if segments else None
        finally:
            try:
                client.files.delete(name=uploaded_file.name)
            except Exception:
                pass
    except Exception as e:
        msg = str(e)
        if "RESOURCE_EXHAUSTED" in msg or "429" in msg:
            # Google's own error embeds how long it wants us to wait
            # (e.g. "retryDelay': '51s'"); fall back to a fixed 60s if that
            # isn't present, and cap at 5 minutes so a huge/unexpected value
            # can't accidentally disable Gemini for the rest of the day.
            delay_match = re.search(r"retryDelay['\"]?\s*:\s*['\"]?(\d+(?:\.\d+)?)s", msg)
            delay = min(float(delay_match.group(1)), 300.0) if delay_match else 60.0
            _gemini_cooldown_until = time.monotonic() + delay
            print(f"[transcribe] Gemini rate/quota limited, skipping it for the next {delay:.0f}s: {e}")
        else:
            print(f"[transcribe] Gemini native audio failed: {e}")
        return None


def _try_mlx_whisper(file_path: str, language: str):
    try:
        import mlx_whisper
    except Exception:
        return None
    try:
        result = mlx_whisper.transcribe(
            file_path, path_or_hf_repo="mlx-community/whisper-turbo",
            task="transcribe", language=language,
            condition_on_previous_text=False, no_speech_threshold=0.6,
            initial_prompt=_INITIAL_PROMPT,
            # word_timestamps unlocks hallucination_silence_threshold: Whisper's
            # own built-in check that re-examines a segment predicted over a
            # >=2s silent/near-silent gap and drops it if the words don't
            # actually line up with sound there. Verified this adds no change
            # to a clean-audio transcript (same text, ~2.6s for a 9s clip) --
            # it only removes segments that were already suspect.
            word_timestamps=True, hallucination_silence_threshold=2.0,
        )
        return (result.get("segments", []), result.get("language"))
    except Exception as e:
        print(f"[transcribe] mlx-whisper failed: {e}")
        return None


def _try_local_whisper(file_path: str, language: str):
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return None
    try:
        model_size = os.getenv("WHISPER_MODEL", "small")
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments_generator, info = model.transcribe(
            file_path, task="transcribe", language=language, vad_filter=True,
            condition_on_previous_text=False, no_speech_threshold=0.6,
            initial_prompt=_INITIAL_PROMPT,
        )
        segments = [{"start": seg.start, "end": seg.end, "text": seg.text} for seg in segments_generator]
        return (segments, getattr(info, "language", None))
    except Exception as e:
        print(f"[transcribe] faster-whisper failed: {e}")
        return None


def _try_openai_whisper(file_path: str, language: str):
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        kwargs = {"model": "whisper-1", "response_format": "verbose_json"}
        if language:  # omit entirely for auto-detect — the API treats a
            kwargs["language"] = language  # missing param as "detect it", not a literal null
        with open(file_path, "rb") as f:
            resp = client.audio.transcriptions.create(file=f, **kwargs)
        detected = getattr(resp, "language", None) or language
        if hasattr(resp, "segments") and resp.segments:
            return ([{"start": s.start, "end": s.end, "text": s.text} for s in resp.segments], detected)
        return ([{"start": 0.0, "end": 1.0, "text": resp.text}], detected)
    except Exception as e:
        print(f"[transcribe] OpenAI whisper failed: {e}")
        return None
