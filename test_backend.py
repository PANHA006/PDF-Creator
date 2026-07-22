import os
import sys
import io

# Set stdout encoding to utf-8 if possible to avoid crashes on Windows,
# or fallback to ASCII replacements.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

print("=== PDF Creator & OCR Scanner Diagnostic Tool ===")
print(f"Python version: {sys.version}\n")

# 1. Test Pillow (PIL)
print("1. Testing Pillow (PIL) library...")
try:
    from PIL import Image
    # Create a small dummy image in memory
    img = Image.new('RGB', (100, 100), color='red')
    pdf_buffer = io.BytesIO()
    img.save(pdf_buffer, format='PDF')
    print("SUCCESS: Pillow can create and compile PDF documents.\n")
except Exception as e:
    print(f"FAILED: Pillow has issues! Error: {e}\n")

# 2. Test pytesseract and Tesseract OCR installation
print("2. Testing Tesseract OCR integration...")
try:
    import pytesseract
    
    # Common installation paths on Windows
    paths_to_check = [
        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe'
    ]
    
    found_path = None
    for p in paths_to_check:
        if os.path.exists(p):
            found_path = p
            break
            
    if found_path:
        print(f"INFO: Found Tesseract binary at: {found_path}")
        pytesseract.pytesseract.tesseract_cmd = found_path
    else:
        print("INFO: Tesseract binary not found in default C:\\Program Files locations.")
        print("Checking if tesseract is available in system PATH...")

    # Try to check version
    version = pytesseract.get_tesseract_version()
    print(f"SUCCESS: Tesseract version detected: {version}")
    
    # Configure local tessdata path
    local_tessdata = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tessdata')
    os.environ['TESSDATA_PREFIX'] = local_tessdata
    print(f"INFO: Configured local TESSDATA_PREFIX to: {local_tessdata}")
    
    # Check languages
    langs = pytesseract.get_languages(config='')
    print(f"INFO: Available Languages in Tesseract: {langs}")
    
    if 'khm' in langs:
        print("SUCCESS: Khmer language data (khm) is INSTALLED!")
    else:
        print("WARNING: Khmer language data (khm) is NOT FOUND!")
        print("To scan Khmer text, please download 'khm.traineddata' and copy it to your 'tessdata' folder.")
        
    if 'eng' in langs:
        print("SUCCESS: English language data (eng) is INSTALLED!")
    else:
        print("WARNING: English language data (eng) is NOT FOUND!")

except Exception as e:
    print("FAILED: Tesseract OCR integration failed.")
    print(f"Error detail: {e}")
    print("\nHow to fix:")
    print("1. Download & install Tesseract OCR for Windows from: https://github.com/UB-Mannheim/tesseract/wiki")
    print("2. Make sure to download Khmer language support during installation.")
    print("3. Check that C:\\Program Files\\Tesseract-OCR is in your system Environment Variables (PATH).")

print("\n=================================================")
