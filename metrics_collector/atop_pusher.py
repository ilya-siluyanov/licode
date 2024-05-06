import sys
import httpx
import json
import asyncio

client = httpx.AsyncClient()


async def send_bandwi(data):
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'BANDWI',
        'metric_value': data['info']['totalrsz'],
    }
    print(json.dumps(body))
    await client.post("http://localhost:10000/metrics", json=body)


async def send_net(data):
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'BANDWI',
        'metric_value': data['net']['totalrsz'],
    }
    print(json.dumps(body))
    asyncio.create_task(client.post("http://localhost:10000/metrics", json=body))
    body = {
        'ts': data['timestamp'],
        'clientId': 'SFU',
        'metric_name': 'BANDWO',
        'metric_value': data['net']['totalssz'],
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
