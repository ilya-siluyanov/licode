from datetime import datetime, timezone
from uuid import uuid4
from fastapi import FastAPI
from pydantic import BaseModel
import redis
import uvicorn


app = FastAPI()
r = redis.Redis(host="localhost", port=6379, db=0, decode_responses=True)


class Metric(BaseModel):
    ts: datetime
    clientId: str
    metric_name: str
    metric_value: float


@app.post("/metrics")
async def collect_metric(
    __root__: Metric,
):
    key = f"metric_{__root__.ts.timestamp()}_{str(uuid4())}"
    r.set(key, __root__.model_dump_json())


@app.post('/metrics/start')
async def add_starter():
    metric = Metric(ts=datetime.now(tz=timezone.utc), clientId='', metric_name='start', metric_value=1)
    key = f"metric_{metric.ts.timestamp()}_{str(uuid4())}"
    r.set(key, metric.model_dump_json())


class Connection(BaseModel):
    ts: datetime
    clientId: str

    class Edge(BaseModel):
        targetId: str
        candidateAddr: str

    edges: list[Edge]


@app.post("/connections")
async def collect_connections(
    __root__: Connection,
):
    key = f"connection_{__root__.ts.timestamp()}_{str(uuid4())}"
    r.set(key, __root__.model_dump_json())


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=10000)
