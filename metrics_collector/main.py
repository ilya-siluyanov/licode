from datetime import datetime
from fastapi import FastAPI
from pydantic import BaseModel
import redis


app = FastAPI()
r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
r_ts = r.ts()
TS_KEY = "licode_events"
if r.exists(TS_KEY):
    r_ts.create(TS_KEY)


class Metric(BaseModel):
    ts: datetime
    clientId: str
    metric_name: str
    metric_value: float


@app.post("/metrics")
async def collect_metric(
    __root__: Metric,
):
    r_ts.add(TS_KEY, int(__root__.ts.timestamp()), 1, labels=__root__.model_dump())
