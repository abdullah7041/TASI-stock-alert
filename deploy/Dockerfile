# Cloud Run Job image for the delayed TASI producer.
#
# The job is the same Python producer the GitHub schedule runs; only the
# entrypoint and the state backend differ. Keeping one codebase is what makes
# the GitHub fallback a real rollback rather than a second implementation.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MODE=session

WORKDIR /app

COPY requirements.txt requirements-runtime.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-runtime.txt

COPY . .

# Fail the build, not the 09:40 run, if a module the schedule needs is broken.
RUN python -m compileall -q main.py movement.py session_gate.py runtime research

# Cloud Scheduler sets MODE per schedule; runtime.job gates it against the
# Riyadh session before anything is collected, decided, or sent.
ENTRYPOINT ["python", "-m", "runtime.job"]
