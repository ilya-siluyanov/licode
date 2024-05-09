from collections import defaultdict
import httpx
import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from matplotlib.ticker import FormatStrFormatter
from datetime import datetime

plt.plot
# Define data
metrics = httpx.get("https://collector.webrtc-thesis.ru/metrics/latest").json()
# Extract data for plotting

figure, axis = plt.subplots(2, 2)
system_metrics: dict[str, tuple[list[datetime], list[float]]] = defaultdict(lambda: ([], []))
groups: dict[str, set[str]] = {
    "NET": {"UDPIN", "UDPOUT", "TCPIN", "TCPOUT"},
    "CPU": {"CPUTOTAL"},
    "MEM": {"VMEM", "RMEM"},
}
plots: dict[str, Axes] = {
    "NET": axis[0, 0],
    "CPU": axis[0, 1],
    "MEM": axis[1, 0],
}

units = {
    "NET": "Kbps",
    "CPU": "sec",
    "MEM": "MiB",
}


j = 0
for metric in metrics:
    if "metric_name" in metric:
        name = metric['metric_name']
        ts = datetime.fromisoformat(metric["ts"][:-1])
        metric_storage = system_metrics[name]
        metric_storage[0].append(ts)
        metric_storage[1].append(metric['metric_value'])

for metric, (tss, values) in system_metrics.items():
    system_metrics[metric][0].pop(0)
    system_metrics[metric][1].pop(0)

for name, plot in plots.items():
    plot.set_title(f"{name} stats")
    for metric_name in groups[name]:
        timestamps, metric_values = system_metrics[metric_name]
        plot.yaxis.set_major_formatter(FormatStrFormatter(f"%.2f {units[name]}"))
        plot.plot(timestamps, metric_values, label=metric_name, linestyle="solid")


def find_closest(input_ts: datetime, metricsets: list[tuple[list[datetime], list[float]]]) -> float:
    to_return = 0
    for (tss, metrics) in metricsets:
        closest_value = 0
        for ts, v in zip(tss, metrics):
            if ts > input_ts:
                break
            closest_value = v
        to_return = max(to_return, closest_value)
    return to_return


for group, plot in plots.items():
    sfu_conn_ts = []
    sfu_conn_values = []
    sfu_disconn_ts = []
    sfu_disconn_values = []
    master_conn_ts = []
    master_conn_values = []
    metricsets = []
    for metric_name in groups[group]:
        metricset = system_metrics[metric_name]
        metricsets.append(metricset)
    for metric in metrics:
        if "dataType" in metric and metric["dataType"] == "connection":
            timestamp = datetime.fromisoformat(metric["ts"][:-1])
            if metric["edge"]["targetId"] == "SFU" or metric['clientId'] == 'SFU':
                if metric["edge"]['type_'] == 'add':
                    sfu_conn_ts.append(timestamp)
                    sfu_conn_values.append(find_closest(timestamp, metricsets))
                else:
                    sfu_disconn_ts.append(timestamp)
                    sfu_disconn_values.append(find_closest(timestamp, metricsets))
            else:
                master_conn_ts.append(timestamp)
                master_conn_values.append(find_closest(timestamp, metricsets))
    plot.plot(sfu_conn_ts, sfu_conn_values, color='y', marker='o', linestyle='None', label='SFU connection')
    plot.plot(sfu_disconn_ts, sfu_disconn_values, color='r', marker='o', linestyle='None', label='SFU disconnect')
    plot.plot(master_conn_ts, master_conn_values, color='g', marker='o', linestyle='None', label='Master connection')
    plot.legend()
    plot.grid(True)

# Show plot
plt.show()
