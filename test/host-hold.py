#!/usr/bin/env python3
"""Host regression: speech-like pauses must not release the duck.
Plays tone 1s / silence 1.5s / tone 1s / silence 2s / tone 1s through afplay
(quiet: 100 Hz at -45 dBFS) and reads the native host's frames.
Pass: afplay is reported continuously from first sound to the end, then released
within 5 s after it stops. Usage: python3 test/host-hold.py [host-binary]"""
import json, math, os, struct, subprocess, sys, tempfile, threading, time, wave

host = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'build', 'musicduck-host')
fs, amp = 48000, 10 ** (-45 / 20) * math.sqrt(2)
wav = os.path.join(tempfile.mkdtemp(), 'gaps.wav')
with wave.open(wav, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(fs)
    frames = bytearray()
    for secs, on in [(1, 1), (1.5, 0), (1, 1), (2, 0), (1, 1)]:
        for i in range(int(fs * secs)):
            v = int(32767 * amp * math.sin(2 * math.pi * 100 * i / fs)) if on else 0
            frames += struct.pack('<hh', v, v)
    w.writeframes(bytes(frames))

p = subprocess.Popen([host], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
events = []  # (t, playing?)
def read():
    while True:
        h = p.stdout.read(4)
        if len(h) < 4: return
        msg = json.loads(p.stdout.read(struct.unpack('<I', h)[0]))
        events.append((time.time(), 'afplay' in msg.get('apps', [])))
threading.Thread(target=read, daemon=True).start()
time.sleep(1.5)
t0 = time.time(); subprocess.run(['afplay', wav]); t_end = time.time()
time.sleep(5.5); p.kill()

on = [t for t, a in events if a]
flips = [round(t - t0, 2) for (t, a), (_, b) in zip(events[1:], events) if a != b]
first = on[0] if on else None
released = [t for t, a in events if not a and first and t > first]
ok_cont = first is not None and all(t >= t_end - 0.3 for t in released)
ok_rel = bool(released) and released[0] - t_end < 5
print('transitions (s after start):', [round(t - t0, 2) for t, a in events if first and t >= first and True], 'states:', [a for t, a in events if first and t >= first])
print('PASS' if ok_cont else 'FAIL', 'held through pauses')
print('PASS' if ok_rel else 'FAIL', 'released after stop', round(released[0] - t_end, 2) if released else None, 's')
sys.exit(0 if ok_cont and ok_rel else 1)
