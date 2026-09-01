import os
import sys
import io
import requests

try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

print("=== PDF Creator & Direct Gemini Vision OCR Diagnostic Tool ===")
print(f"Python version: {sys.version}\n")

# 1. Test Pillow (PIL)
print("1. Testing Pillow (PIL) library...")
try:
    from PIL import Image
    img = Image.new('RGB', (100, 100), color='red')
    pdf_buffer = io.BytesIO()
    img.save(pdf_buffer, format='PDF')
    print("SUCCESS: Pillow can create and compile PDF documents.\n")
except Exception as e:
    print(f"FAILED: Pillow has issues! Error: {e}\n")

# 2. Test PyMuPDF (fitz)
print("2. Testing PyMuPDF (fitz) library...")
try:
    import fitz
    print(f"SUCCESS: PyMuPDF version detected: {fitz.__version__}\n")
except Exception as e:
    print(f"FAILED: PyMuPDF has issues! Error: {e}\n")

# 3. Test Gemini API connectivity
print("3. Testing Gemini AI Vision integration...")
if os.path.exists('.env'):
    with open('.env', 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                if key.strip() == 'GEMINI_API_KEY':
                    os.environ['GEMINI_API_KEY'] = val.strip()

api_key = os.environ.get("GEMINI_API_KEY")

if not api_key:
    print("WARNING: GEMINI_API_KEY is missing from your .env file!")
else:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key={api_key}"
    try:
        res = requests.post(url, json={"contents": [{"parts": [{"text": "Hello"}]}]}, timeout=10)
        if res.status_code == 200:
            print("SUCCESS: Connected to Gemini AI Vision API successfully!\n")
        else:
            print(f"WARNING: Gemini API returned status code {res.status_code}: {res.text[:150]}\n")
    except Exception as e:
        print(f"FAILED: Gemini API connection test failed: {e}\n")

print("=================================================")
