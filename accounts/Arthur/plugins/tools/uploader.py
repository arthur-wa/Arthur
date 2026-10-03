import sys
import os
import subprocess

# التحقق من وجود مكتبة requests وتثبيتها تلقائياً إذا كانت مفقودة
try:
    import requests
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests

def upload_to_telegram(token, chat_id, file_path, caption):
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    max_tg_size = 49 * 1024 * 1024  # 49 ميجابايت لتفادي حد الـ 50 المسموح به

    try:
        if not os.path.exists(file_path):
            print(f"ERROR: File not found at {file_path}")
            sys.exit(1)

        file_size = os.path.getsize(file_path)

        if file_size <= max_tg_size:
            # إذا كان حجم الملف أصغر من 50 ميجابايت، يتم رفعه كقطعة واحدة
            with open(file_path, 'rb') as doc:
                files = {'document': doc}
                data = {'chat_id': chat_id, 'caption': caption, 'parse_mode': 'Markdown'}
                r = requests.post(url, data=data, files=files, timeout=600)
                r.raise_for_status()
        else:
            # إذا تجاوز 50 ميجابايت، يتم تقسيمه ورفعه على أجزاء
            part_num = 1
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(max_tg_size)
                    if not chunk:
                        break
                    
                    part_path = f"{file_path}.part{part_num}"
                    with open(part_path, 'wb') as chunk_file:
                        chunk_file.write(chunk)
                    
                    part_caption = f"{caption}\n\n🧩 *الجزء رقم: {part_num}*"
                    with open(part_path, 'rb') as doc:
                        r = requests.post(url, data={'chat_id': chat_id, 'caption': part_caption, 'parse_mode': 'Markdown'}, files={'document': doc}, timeout=600)
                        r.raise_for_status()
                    
                    os.remove(part_path)
                    part_num += 1

        print("UPLOAD_SUCCESS")
    except Exception as e:
        print(f"PYTHON_ERROR: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    upload_to_telegram(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4])