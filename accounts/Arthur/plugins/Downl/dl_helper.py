import sys, os, json, yt_dlp

url = sys.argv[1]
out_dir = sys.argv[2]
mode = sys.argv[3] if len(sys.argv) > 3 else 'video'

outtmpl = os.path.join(out_dir, 'file.%(ext)s')

if mode == 'audio':
    opts = {
        'format': 'bestaudio/best',
        'outtmpl': outtmpl,
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'no_check_certificates': True,
        'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '128'}],
    }
else:
    opts = {
        'format': 'b[ext=mp4][height<=720]/b[ext=mp4]/b[height<=720]/b',
        'outtmpl': outtmpl,
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'no_check_certificates': True,
    }

# حجب stdout أثناء التحميل عشان JSON يطلع نظيف
_real_stdout = sys.stdout
sys.stdout = sys.stderr

with yt_dlp.YoutubeDL(opts) as ydl:
    info = ydl.extract_info(url, download=True)
    filename = ydl.prepare_filename(info)
    if not os.path.exists(filename):
        base = os.path.splitext(filename)[0]
        for ext in ['.mp4', '.mkv', '.webm', '.mp3', '.m4a']:
            if os.path.exists(base + ext):
                filename = base + ext
                break

sys.stdout = _real_stdout
print(json.dumps({'file': filename, 'title': (info.get('title') or '')[:80]}))
