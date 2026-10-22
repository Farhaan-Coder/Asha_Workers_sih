"""
Optional speaker diarization — ported from MOM-generator's backend/diarization.py.

Not installed by default (torch + torchaudio + speechbrain are large
downloads not needed to demo the core clinical pipeline). transcribe.py
already wraps its use of this module in try/except, so the app runs
identically without it — transcripts just come back without "Speaker N:"
prefixes. To enable: `pip install torch torchaudio speechbrain` in
backend/.venv, then this import succeeds automatically.
"""
import os
import tempfile
import subprocess

import numpy as np


class DiarizationEngine:
    """Token-free, fully local speaker diarization: SpeechBrain ECAPA-TDNN
    embeddings clustered with scikit-learn's AgglomerativeClustering."""

    def __init__(self, device=None):
        import torch
        from speechbrain.inference.speaker import EncoderClassifier

        if device is None:
            if torch.backends.mps.is_available():
                self.device = "mps"
            elif torch.cuda.is_available():
                self.device = "cuda"
            else:
                self.device = "cpu"
        else:
            self.device = device

        # SpeechBrain's EncoderClassifier has a known mps init bug; force cpu for it.
        self.sb_device = "cpu"
        self.classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=os.path.join(os.path.expanduser("~"), ".cache", "speechbrain", "spkrec-ecapa-voxceleb"),
            run_opts={"device": self.sb_device},
        )

    def diarize(self, audio_path: str, segments: list, num_speakers=None) -> list:
        import torch
        import torchaudio
        from sklearn.cluster import AgglomerativeClustering

        if not segments:
            return segments

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_wav = tmp.name
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", audio_path, "-ar", "16000", "-ac", "1", tmp_wav],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            signal, fs = torchaudio.load(tmp_wav)
            signal = signal.to(self.sb_device)

            embeddings, valid_segments = [], []
            for seg in segments:
                start_sample = int(seg["start"] * fs)
                end_sample = int(seg["end"] * fs)
                if end_sample - start_sample < int(0.5 * fs):
                    continue
                seg_audio = signal[:, start_sample:end_sample]
                with torch.no_grad():
                    emb = self.classifier.encode_batch(seg_audio)
                    embeddings.append(emb.squeeze().cpu().numpy())
                valid_segments.append(seg)

            if not valid_segments:
                for seg in segments:
                    seg["speaker"] = "Speaker 1"
                return segments

            X = np.stack(embeddings)
            clusterer = (
                AgglomerativeClustering(n_clusters=None, distance_threshold=0.7, metric="cosine", linkage="average")
                if num_speakers is None
                else AgglomerativeClustering(n_clusters=num_speakers, metric="cosine", linkage="average")
            )
            labels = clusterer.fit_predict(X)
            for seg, label in zip(valid_segments, labels):
                seg["speaker"] = f"Speaker {label + 1}"

            current_speaker = valid_segments[0]["speaker"] if valid_segments else "Speaker 1"
            for seg in segments:
                if "speaker" not in seg:
                    seg["speaker"] = current_speaker
                else:
                    current_speaker = seg["speaker"]
            return segments
        except Exception as e:
            print(f"[diarization] error: {e}")
            for seg in segments:
                if "speaker" not in seg:
                    seg["speaker"] = "Speaker 1"
            return segments
        finally:
            if os.path.exists(tmp_wav):
                os.remove(tmp_wav)
