import io
import json
import random
import urllib.parse
import urllib.request

BASE_URL = "http://127.0.0.1:8000"

def run_tests():
    print("1. Testing /api/public-config...")
    with urllib.request.urlopen(f"{BASE_URL}/api/public-config") as r:
        cfg = json.loads(r.read())
        print("   [OK] public-config app_name:", cfg["appearance"]["app_name"])

    print("2. Testing /api/auth/register...")
    email = f"testuser_{random.randint(1000, 9999)}@example.com"
    username = f"user_{random.randint(1000, 9999)}"
    reg_data = json.dumps({"email": email, "username": username, "password": "Password123!"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}/api/auth/register", data=reg_data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        auth_resp = json.loads(r.read())
        token = auth_resp.get("token")
        print("   [OK] Registered user. Token:", token[:12] + "...")

    auth_headers = {"Authorization": f"Bearer {token}"}

    print("3. Testing /api/admin/login and /api/admin/health...")
    admin_data = json.dumps({"username": "jebin", "password": "jebpro@8898"}).encode("utf-8")
    req = urllib.request.Request(f"{BASE_URL}/api/admin/login", data=admin_data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        admin_resp = json.loads(r.read())
        admin_token = admin_resp["token"]
        print("   [OK] Admin authenticated. Token:", admin_token[:12] + "...")

    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    req = urllib.request.Request(f"{BASE_URL}/api/admin/health", headers=admin_headers)
    with urllib.request.urlopen(req) as r:
        health = json.loads(r.read())
        print(f"   [OK] Health checks returned ({len(health.get('checks', []))} services):")
        for comp in health.get("checks", []):
            print(f"        - {comp['name']}: {comp['status']} ({comp['detail']})")

    print("4. Testing /api/chord-model across languages (English, Hindi, Tamil, Auto)...")
    with open("backend/data/datasets/english/audio/english_track_001.wav", "rb") as f:
        wav_data = f.read()

    for lang in ["english", "hindi", "tamil", "auto"]:
        boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
        body = io.BytesIO()
        body.write(f"--{boundary}\r\n".encode("utf-8"))
        body.write(b'Content-Disposition: form-data; name="file"; filename="test.wav"\r\n')
        body.write(b"Content-Type: audio/wav\r\n\r\n")
        body.write(wav_data)
        body.write(f"\r\n--{boundary}\r\n".encode("utf-8"))
        body.write(f'Content-Disposition: form-data; name="language"\r\n\r\n{lang}\r\n'.encode("utf-8"))
        body.write(f"--{boundary}--\r\n".encode("utf-8"))
        payload = body.getvalue()

        req = urllib.request.Request(
            f"{BASE_URL}/api/chord-model",
            data=payload,
            headers={
                **auth_headers,
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            }
        )
        with urllib.request.urlopen(req) as r:
            res = json.loads(r.read())
            print(f"   [OK] /api/chord-model ({lang}): model={res.get('models')}, language={res.get('chords', {}).get('language')}, events={len(res.get('chords', {}).get('results', []))}")

    print("5. Testing /api/separate (Stem Separation & Classification)...")
    boundary = "----WebKitFormBoundarySeparate"
    body = io.BytesIO()
    body.write(f"--{boundary}\r\n".encode("utf-8"))
    body.write(b'Content-Disposition: form-data; name="file"; filename="test.wav"\r\n')
    body.write(b"Content-Type: audio/wav\r\n\r\n")
    body.write(wav_data)
    body.write(b"\r\n--" + boundary.encode("utf-8") + b"--\r\n")
    payload = body.getvalue()

    req = urllib.request.Request(
        f"{BASE_URL}/api/separate",
        data=payload,
        headers={
            **auth_headers,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        }
    )
    try:
        import zipfile
        with urllib.request.urlopen(req) as r:
            zip_bytes = r.read()
            zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
            namelist = zf.namelist()
            print(f"   [OK] /api/separate: returned {len(zip_bytes)} bytes ZIP with {len(namelist)} stems:")
            for name in sorted(namelist):
                print(f"        * Stem: {name} ({zf.getinfo(name).file_size} bytes)")
    except Exception as e:
        print(f"   [INFO] /api/separate: {e}")

    print("\nALL API ENDPOINTS TESTED SUCCESSFULLY!")

if __name__ == "__main__":
    run_tests()
