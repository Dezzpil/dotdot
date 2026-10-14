FROM python:3.12-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config libcairo2-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /tmp/
RUN pip wheel --wheel-dir /wheels -r /tmp/requirements.txt

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 fonts-dejavu-core && rm -rf /var/lib/apt/lists/* \
    && useradd -r -u 10001 dotdot
COPY --from=build /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels
WORKDIR /app
COPY dotdot ./dotdot
USER dotdot
ENV PYTHONUNBUFFERED=1
# queue consumer is added in the next step; for now the image runs the CLI
ENTRYPOINT ["python", "-m", "dotdot.cli"]
