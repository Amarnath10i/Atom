FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy agent code
COPY . .

# Expose port
EXPOSE 8080

# Start the FastAPI service
CMD ["uvicorn", "agents.main:app", "--host", "0.0.0.0", "--port", "8080"]
