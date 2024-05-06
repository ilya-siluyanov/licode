from datetime import datetime, timezone
import logging
from typing import Literal
from uuid import uuid4
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import redis.asyncio as aioredis
import uvicorn


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
r = aioredis.from_url("redis://localhost:6379/0", decode_responses=True)

START_PREFIX = "start_"


class Metric(BaseModel):
    ts: datetime
    clientId: str
    metric_name: str
    metric_value: float

    data_type: str = "metric"


@app.post("/metrics")
async def collect_metric(
    __root__: Metric,
):
    key = f"metric_{__root__.ts.timestamp()}_{str(uuid4())}"
    await r.set(key, __root__.model_dump_json())


@app.post('/metrics/start')
async def add_starter(delete_old: bool = False):
    if delete_old:
        await r.delete(*await r.keys('*'))
    metric = Metric(ts=datetime.now(tz=timezone.utc), clientId='', metric_name='start', metric_value=1)
    key = f"{START_PREFIX}{metric.ts.timestamp()}_{str(uuid4())}"
    await r.set(key, metric.model_dump_json())


class Connection(BaseModel):
    ts: datetime
    clientId: str
    clientType: str = "client"
    dataType: str = "connection"

    class Edge(BaseModel):
        targetId: str
        type_: Literal["add"] | Literal["delete"]
        candidateAddr: str

    edge: Edge


@app.post("/connections")
async def collect_connections(
    __root__: Connection,
):
    key = f"connection_{__root__.ts.timestamp()}_{str(uuid4())}"
    await r.set(key, __root__.model_dump_json())


@app.get("/metrics/latest")
async def get_latest_metrics():
    starts = await r.keys(START_PREFIX + "*")
    latest_key, latest_ts = None, 0
    for key in starts:
        key, ts, _ = key.split("_")
        ts = float(ts)
        logging.warning("%s %s", ts, latest_ts)
        if ts > latest_ts:
            latest_key = key
            latest_ts = ts
    if latest_key is None:
        return JSONResponse(content={"description": "There is no start"}, status_code=404)
    result = []
    for key in await r.keys("*"):
        _, ts, _ = key.split("_")
        ts = float(ts)
        if ts < latest_ts:
            continue
        data = await r.get(key)
        if key.startswith("metric"):
            data = Metric.model_validate_json(data)
        elif key.startswith("connection"):
            data = Connection.model_validate_json(data)
        else:
            logging.warning("Skip key %s", key)
            continue
        result.append(data)
    result.sort(key=lambda x: x.ts.timestamp())
    return result


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=10000)
