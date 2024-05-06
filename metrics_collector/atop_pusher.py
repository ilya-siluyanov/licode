import sys
import httpx
import json

client = httpx.Client()

while True:
    line = sys.stdin.readline()
    data = json.loads(line)
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'BANDWI',
        'metric_value': data['info']['totalrsz'],
    }
    print(json.dumps(body))
    client.post("http://localhost:10000/metrics", json=body)
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'BANDWO',
        'metric_value': data['info']['totalssz'],
    }
    print(json.dumps(body))
    client.post("http://localhost:10000/metrics", json=body)
