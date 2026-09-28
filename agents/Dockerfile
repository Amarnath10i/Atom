# Build from the repository root:  docker build -f agents/Dockerfile .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

COPY agents/requirements.txt agents/requirements.txt
RUN pip install --no-cache-dir -r agents/requirements.txt

COPY agents ./agents

# Railway, Fly and most PaaS hosts inject PORT.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn agents.main:app --host 0.0.0.0 --port ${PORT}"]
