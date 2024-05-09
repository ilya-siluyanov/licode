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
    result['net']['udprsz'] = int(net['udprsz']) / 125
    result['net']['udpssz'] = int(net['udpssz']) / 125
    result['net']['tcprsz'] = int(net['tcprsz']) / 125
    result['net']['tcpssz'] = int(net['tcpssz']) / 125

    cpu = data['cpu']
    result['cpu']['total'] = (int(cpu['utime']) + int(cpu['stime'])) / 100

    mem = data['mem']
    result['mem']['vms'] = int(mem['vmem']) / 1024
    result['mem']['rss'] = int(mem['rmem']) / 1024
    print(json.dumps(result))
