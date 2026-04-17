## Live URL

**`https://api.mosesekerin.name.ng`**

```bash
# Quick validation
curl -s https://api.mosesekerin.name.ng/       | python3 -m json.tool
curl -s https://api.mosesekerin.name.ng/health | python3 -m json.tool
curl -s https://api.mosesekerin.name.ng/me     | python3 -m json.tool

# Verify HTTP redirect
curl -I http://api.mosesekerin.name.ng/
# HTTP/1.1 301 Moved Permanently
# Location: https://api.mosesekerin.name.ng/

# Verify TLS and response headers
curl -sI https://api.mosesekerin.name.ng/health
# HTTP/2 200
# content-type: application/json; charset=utf-8
# strict-transport-security: max-age=63072000; includeSubDomains
```