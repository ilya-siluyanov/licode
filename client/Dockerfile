FROM python:3.12-slim-bookworm

COPY requirements.txt requirements.txt
RUN pip install -r requirements.txt

COPY main.py main.py
ENTRYPOINT ["python", "main.py", "--remote", "--path", "http://localhost:4444"]
