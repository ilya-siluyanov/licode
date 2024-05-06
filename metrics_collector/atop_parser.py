import sys
from datetime import datetime, timezone
import json

while True:
    line = sys.stdin.readline()
    data = json.loads(line)
    data["timestamp"] = datetime.fromtimestamp(data["timestamp"]).replace(tzinfo=timezone.utc).isoformat()
    info = data['info']
    info['totalrsz'] = (int(info['tcprsz']) + int(info['udprsz'])) / 125
    info['totalssz'] = (int(info['tcpssz']) + int(info['udpssz'])) / 125
    del info['tcprsz']
    del info['tcpssz']
    del info['udprsz']
    del info['udpssz']
    print(json.dumps(data))
