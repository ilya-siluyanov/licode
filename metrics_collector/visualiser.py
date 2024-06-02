from collections import defaultdict
import httpx
from matplotlib.dates import DateFormatter
import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from matplotlib.ticker import FormatStrFormatter
from datetime import datetime


figure, axis = plt.subplots(2, 2)
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
    "CLIENTNET": "Kbps",
}


def collect_system_metrics(
    data,
) -> tuple[
    dict[str, tuple[list[datetime], list[float]]],
    dict[str, dict[str, tuple[list[datetime], list[float]]]],
]:
    system_metrics: dict[str, tuple[list[datetime], list[float]]] = defaultdict(
        lambda: ([], [])
    )
    client_metrics_storage: dict[str, dict[str, tuple[list[datetime], list[float]]]] = (
        defaultdict(lambda: defaultdict(lambda: ([], [])))
    )
    for metric in data:
        if "metric_name" not in metric:
            continue
        ts = datetime.fromisoformat(metric["ts"][:-1])

        name = metric["metric_name"]
        if metric["clientId"] == "SFU":
            metric_storage = system_metrics[name]
        else:
            metric_storage = client_metrics_storage[metric["clientId"]][name]

        metric_storage[0].append(ts)
        metric_storage[1].append(metric["metric_value"])

    for metric, (tss, values) in system_metrics.items():
        tss.pop(0)
        values.pop(0)

    return system_metrics, client_metrics_storage


def plot_groups(system_metrics: dict[str, tuple[list[datetime], list[float]]]):
    for name, plot in plots.items():
        plot.set_title(f"{name} stats")
        for metric_name in groups[name]:
            timestamps, metric_values = system_metrics[metric_name]
            plot.xaxis.set_major_formatter(DateFormatter("%H:%M"))
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


def get_events_for_group(
    metrics: list[dict], metricsets: list[tuple[list[datetime], list[float]]]
) -> tuple[
    tuple[list[datetime], list[float]],
    tuple[list[datetime], list[float]],
    tuple[list[datetime], list[float]],
]:
    sfu_conn_ts = []
    sfu_conn_values = []
    sfu_disconn_ts = []
    sfu_disconn_values = []
    master_conn_ts = []
    master_conn_values = []
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
    return (
        (sfu_conn_ts, sfu_conn_values),
        (sfu_disconn_ts, sfu_disconn_values),
        (master_conn_ts, master_conn_values),
    )


def plot_client_net(
    axes: Axes,
    metrics: list[dict],
    client_metrics_storage: dict[str, dict[str, tuple[list[datetime], list[float]]]],
):
    axes.set_title("Client NET stats")
    axes.xaxis.set_major_formatter(DateFormatter("%H:%M"))
    axes.yaxis.set_major_formatter(FormatStrFormatter("%.2f Kbps"))

    metricsets = []
    for client, client_metrics in client_metrics_storage.items():
        for metric_name, (tss, values) in client_metrics.items():
            if metric_name not in ("NETIN", "NETOUT"):
                continue
            derivative: list[float] = []
            for i, v in enumerate(values):
                if i == 0:
                    derivative.append(0)
                    continue
                prev_value = values[i - 1]
                d = max(0, v - prev_value)
                derivative.append(d / 1000)

            metricsets.append((tss, derivative))
            axes.plot(
                tss, derivative, label=f"{metric_name}:{client[0:6]}", linestyle="solid"
            )
    sfu_conn, sfu_disconn, master_conn = get_events_for_group(metrics, metricsets)
    axes.plot(
        *sfu_conn, color="y", marker="o", linestyle="None", label="SFU connection"
    )
    axes.plot(
        *sfu_disconn, color="r", marker="o", linestyle="None", label="SFU disconnect"
    )
    axes.plot(
        *master_conn, color="g", marker="o", linestyle="None", label="Master connection"
    )
    axes.legend()
    axes.grid(True)


def main():
    metrics = httpx.get("https://collector.webrtc-thesis.ru/metrics/latest").json()
    system_metrics, client_metrics = collect_system_metrics(metrics)
    plot_groups(system_metrics)
    for group_name, plot in plots.items():
        metricsets = []
        for metric_name in groups[group_name]:
            metricsets.append(system_metrics[metric_name])
        sfu_conn, sfu_disconn, master_conn = get_events_for_group(metrics, metricsets)
        plot.plot(
            *sfu_conn, color="y", marker="o", linestyle="None", label="SFU connection"
        )
        plot.plot(
            *sfu_disconn,
            color="r",
            marker="o",
            linestyle="None",
            label="SFU disconnect",
        )
        plot.plot(
            *master_conn,
            color="g",
            marker="o",
            linestyle="None",
            label="Master connection",
        )
        plot.legend()
        plot.grid(True)
    plot_client_net(axis[1, 1], metrics, client_metrics)


if __name__ == "__main__":
    main()
