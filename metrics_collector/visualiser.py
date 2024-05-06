import httpx
import matplotlib.pyplot as plt
from datetime import datetime

# Define data
metrics = httpx.get("https://collector.webrtc-thesis.ru/metrics/latest").json()
# Extract data for plotting
timestamps: list[datetime] = []
bandwi_values = []
bandwo_values = []

j = 0
for metric in metrics:
    if "metric_name" in metric:
        if metric["metric_value"] > 1e6:
            continue
        timestamps.append(datetime.fromisoformat(metric["ts"][:-1]))
        if j == 0:
            bandwi_values.append(0)
            bandwo_values.append(0)
            j += 1
            continue
        if metric["metric_name"] == "BANDWI":
            bandwi_values.append(metric["metric_value"])
            bandwo_values.append(bandwo_values[-1])  # For alignment
        elif metric["metric_name"] == "BANDWO":
            bandwo_values.append(metric["metric_value"])
            bandwi_values.append(bandwi_values[-1])  # For alignment

# Plotting
plt.figure(figsize=(10, 5))
plt.plot(timestamps, bandwi_values, label="BANDWI", linestyle="solid")
plt.plot(timestamps, bandwo_values, label="BANDWO", linestyle="solid")


def find_closest(input_ts: datetime) -> float:
    to_return = 0
    for i, ts in enumerate(timestamps):
        if ts <= input_ts:
            in_, out = bandwi_values[i], bandwo_values[i]
            if in_ is None and out is None:
                continue
            if in_ is None:
                to_return = out
            if out is None:
                to_return = in_
            if in_ < out:
                to_return = out
            else:
                to_return = in_
    return to_return


sfu_conn_ts = []
sfu_conn_values = []
sfu_disconn_ts = []
sfu_disconn_values = []
master_conn_ts = []
master_conn_values = []

# Annotate events
for metric in metrics:
    if "dataType" in metric and metric["dataType"] == "connection":
        timestamp = datetime.fromisoformat(metric["ts"][:-1])
        if metric["edge"]["targetId"] == "SFU" or metric['clientId'] == 'SFU':
            if metric["edge"]['type_'] == 'add':
                sfu_conn_ts.append(timestamp)
                sfu_conn_values.append(find_closest(timestamp))
            else:
                sfu_disconn_ts.append(timestamp)
                sfu_disconn_values.append(find_closest(timestamp))
        else:
            master_conn_ts.append(timestamp)
            master_conn_values.append(find_closest(timestamp))

plt.plot(sfu_conn_ts, sfu_conn_values, color='y', marker='o', linestyle='None', label='SFU connection')
plt.plot(sfu_disconn_ts, sfu_disconn_values, color='r', marker='o', linestyle='None', label='SFU disconnect')
plt.plot(master_conn_ts, master_conn_values, color='g', marker='o', linestyle='None', label='Master connection')
# Add legend
plt.legend()

# Add labels and title
plt.xlabel("Timestamp")
plt.ylabel("Value")
plt.title("BANDWI and BANDWO Metrics")

# Show plot
plt.grid(True)
plt.tight_layout()
plt.show()
