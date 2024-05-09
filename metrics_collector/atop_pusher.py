import sys
import httpx
import json
import asyncio

client = httpx.AsyncClient()


async def send_net(data):
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'UDPIN',
        'metric_value': data['net']['udprsz'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'UDPOUT',
        'metric_value': data['net']['udpssz'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'TCPIN',
        'metric_value': data['net']['tcprsz'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'TCPOUT',
        'metric_value': data['net']['tcpssz'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))


async def send_cpu(data):
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'CPUTOTAL',
        'metric_value': data['cpu']['total'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))


async def send_mem(data):
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'VMEM',
        'metric_value': data['mem']['vms'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'RMEM',
        'metric_value': data['mem']['rss'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))


async def main():
    while True:
        line = await asyncio.get_running_loop().run_in_executor(None, sys.stdin.readline)
        data = json.loads(line)
        for coro_func in (
            send_net,
            send_cpu,
            send_mem,
        ):
            asyncio.create_task(coro_func(data))

asyncio.run(main())
