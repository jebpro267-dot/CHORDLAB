import httpx
import re

base = "http://localhost:5173"
visited = set()
queue = ["/src/main.tsx", "/src/routes/index.tsx", "/src/routes/analyze.tsx", "/src/routes/song.$id.tsx"]
errors = []

with httpx.Client() as client:
    while queue and len(visited) < 150:
        path = queue.pop(0)
        if path in visited:
            continue
        visited.add(path)
        url = base + path
        try:
            r = client.get(url)
            if r.status_code != 200:
                errors.append((path, r.status_code, r.text[:200]))
            else:
                imports = re.findall(r'from\s+["\']([^"\']+)["\']', r.text)
                imports += re.findall(r'import\s+["\']([^"\']+)["\']', r.text)
                for imp in imports:
                    if imp.startswith("/src") or imp.startswith("/node_modules"):
                        clean_imp = imp.split("?")[0]
                        if clean_imp not in visited and clean_imp not in queue:
                            queue.append(imp)
        except Exception as e:
            errors.append((path, str(e)))

print(f"Checked {len(visited)} modules. Errors: {len(errors)}")
for err in errors:
    print("ERROR:", err)
