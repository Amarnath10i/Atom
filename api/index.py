from agents.main import app as _app

async def app(scope, receive, send):
    if scope["type"] == "http":
        path = scope.get("path", "")
        # Strip the /api/agents prefix so FastAPI's @app.post("/guard") routes match
        if path.startswith("/api/agents"):
            scope["path"] = path[len("/api/agents"):]
            if not scope["path"]:
                scope["path"] = "/"
    return await _app(scope, receive, send)
