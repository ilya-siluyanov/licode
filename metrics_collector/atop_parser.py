import sys
from datetime import datetime, timezone
import json

while True:
    line = sys.stdin.readline()
    data = json.loads(line)
    result = {
        'timestamp': 0,
        'net': {},
        'cpu': {},
        'mem': {},
    }
    result["timestamp"] = datetime.fromtimestamp(data["timestamp"]).replace(tzinfo=timezone.utc).isoformat()

    net = data['net']
    result['net']['totalrsz'] = (int(net['tcprsz']) + int(net['udprsz'])) / 125
    result['net']['totalssz'] = (int(net['tcpssz']) + int(net['udpssz'])) / 125

    cpu = data['cpu']
    result['cpu']['total'] = (int(cpu['utime']) + int(cpu['stime'])) / 1000

    mem = data['mem']
    result['mem']['vms'] = mem['vmem']
    result['mem']['rss'] = mem['rmem']
    print(json.dumps(result))
