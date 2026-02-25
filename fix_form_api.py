#!/usr/bin/env python3
"""Delete empty question from Google Form using Forms API with OAuth"""
import json
import http.server
import urllib.parse
import urllib.request
import webbrowser
import threading
import sys

FORM_ID = "1ogjAxMoOg69zcJdnRjKIR0Ad7AdR2z5FdXlnOpso130"
# Using Google's own OAuth client (from gcloud)
CLIENT_ID = "32555940559.apps.googleusercontent.com"
CLIENT_SECRET = "ZmssLNjJy2998hD4CTg2ejr2"
REDIRECT_URI = "http://localhost:8766/callback"
SCOPES = "https://www.googleapis.com/auth/forms.body"

auth_code = None

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        if 'code' in params:
            auth_code = params['code'][0]
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'<h1>Auth OK! Close this tab.</h1>')
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'No code')
    def log_message(self, *args): pass

# Start local server
server = http.server.HTTPServer(('localhost', 8765), Handler)
thread = threading.Thread(target=server.handle_request)
thread.start()

# Open browser for auth
auth_url = (f"https://accounts.google.com/o/oauth2/auth?"
    f"client_id={CLIENT_ID}&redirect_uri={urllib.parse.quote(REDIRECT_URI)}"
    f"&response_type=code&scope={urllib.parse.quote(SCOPES)}"
    f"&access_type=offline&prompt=consent")

print(f"Opening browser for Google auth...")
webbrowser.open(auth_url)

# Wait for callback
thread.join(timeout=120)
server.server_close()

if not auth_code:
    print("ERROR: No auth code received")
    sys.exit(1)

print("Got auth code, exchanging for token...")

# Exchange code for token
token_data = urllib.parse.urlencode({
    'code': auth_code,
    'client_id': CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'redirect_uri': REDIRECT_URI,
    'grant_type': 'authorization_code'
}).encode()

req = urllib.request.Request('https://oauth2.googleapis.com/token', data=token_data)
resp = urllib.request.urlopen(req)
tokens = json.loads(resp.read())
access_token = tokens['access_token']
print("Got access token!")

# Get form
headers = {"Authorization": f"Bearer {access_token}"}
req = urllib.request.Request(f"https://forms.googleapis.com/v1/forms/{FORM_ID}", headers=headers)
form = json.loads(urllib.request.urlopen(req).read())

items = form.get('items', [])
print(f"\nForm has {len(items)} items:")
for i, item in enumerate(items):
    title = item.get('title', '(no title)')
    qtype = list(item.get('questionItem', {}).get('question', {}).keys()) if 'questionItem' in item else ['N/A']
    print(f"  {i}: '{title}' [{item['itemId']}] {qtype}")

# Find empty/untitled question
to_delete = []
for i, item in enumerate(items):
    title = item.get('title', '').strip()
    if not title or title == '질문':
        to_delete.append(i)
        print(f"\n>>> Will delete item {i}: '{title}' [{item['itemId']}]")

if not to_delete:
    print("\n✅ No empty questions found!")
    sys.exit(0)

# Delete from bottom to top
requests_list = []
for idx in reversed(to_delete):
    requests_list.append({
        "deleteItem": {
            "location": {"index": idx}
        }
    })

body = json.dumps({"requests": requests_list}).encode()
req = urllib.request.Request(
    f"https://forms.googleapis.com/v1/forms/{FORM_ID}:batchUpdate",
    data=body,
    headers={**headers, "Content-Type": "application/json"},
    method="POST"
)

resp = urllib.request.urlopen(req)
print(f"\n✅ Deleted {len(to_delete)} empty question(s)!")
print("Form is now clean.")
