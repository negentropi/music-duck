#!/usr/bin/env python3
"""Host regression: when another app goes silent (video paused) the duck must
release quickly, even while the app still holds its audio output open.
Plays tone 1s then 3s of silence through afplay (quiet: 100 Hz at -45 dBFS) and
reads the native host's frames. Pass: afplay released within 1.2s of the tone
ending, before afplay exits. Usage: python3 test/host-hold.py [host-binary]"""
import json, math, os, struct, subprocess, sys, tempfile, threading, time, wave

host = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'build', 'musicduck-host')
fs, amp = 48000, 10 ** (-45 / 20) * math.sqrt(2)
wav = os.path.join(tempfile.mkdtemp(), 'pause.wav')
with wave.open(wav, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(fs)
    frames = bytearray()
    for i in range(fs * 4):
        v = int(32767 * amp * math.sin(2 * math.pi * 100 * i / fs)) if i < fs else 0
        frames += struct.pack('<hh', v, v)
    w.writeframes(bytes(frames))

p = subprocess.Popen([host], stdin=subprocess.PIPE, stdout=subprocess.PIPE)
events = []  # (t, afplay reported?)
def read():
    while True:
        h = p.stdout.read(4)
        if len(h) < 4: return
        msg = json.loads(p.stdout.read(struct.unpack('<I', h)[0]))
        events.append((time.time(), 'afplay' in msg.get('apps', [])))
threading.Thread(target=read, daemon=True).start()
time.sleep(1.5)
play = subprocess.Popen(['afplay', wav])
t_tone_end = time.time() + 1  # afplay starts output within a few ms
play.wait(); time.sleep(1); p.kill()

on = [t for t, a in events if a]
off = [t for t, a in events if not a and on and t > on[0]]
print('ducked' if on else 'never reported', '| released', round(off[0] - t_tone_end, 2) if off else None, 's after the tone ended')
ok = bool(on) and bool(off) and off[0] - t_tone_end < 1.2
print('PASS' if ok else 'FAIL', 'quick release on pause')
sys.exit(0 if ok else 1)
