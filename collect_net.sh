sudo atop -P PRN -J PRN 1 | jq --unbuffered -c '{ timestamp: .timestamp, info: (.PRN[] | select(.pid == 662409))}' | py -u metrics_collector/atop_parser.py | py metrics_collector/atop_pusher.py