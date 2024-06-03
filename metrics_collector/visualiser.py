from collections import defaultdict
import httpx
from matplotlib.dates import DateFormatter
import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from matplotlib.ticker import FormatStrFormatter
from datetime import datetime
import scipy
from scipy import interpolate


thresholds = {
    "NETIN": 500,
    "NETOUT": 500,
}

S = 1

groups: dict[str, set[str]] = {
    "Server NETIN": {"TCPIN", "UDPIN"},
    "Server NETOUT": {"TCPOUT", "UDPOUT"},
    "CPU": {"CPUTOTAL"},
    "VMEM": {"VMEM"},
    "RMEM": {"RMEM"},
    "NETIN": {"NETIN"},
    "NETOUT": {"NETOUT"},
}

figures = [
    plt.figure(),
    plt.figure(),
    plt.figure(),
    plt.figure(),
    plt.figure(),
    plt.figure(),
    plt.figure(),
]

axes: list[Axes] = [
    figures[0].subplots(1, 1),
    figures[1].subplots(1, 1),
    figures[2].subplots(1, 1),
    figures[3].subplots(1, 1),
    figures[4].subplots(1, 1),
    figures[5].subplots(1, 1),
    figures[6].subplots(1, 1),
]

for fig in figures:
    fig.set_size_inches(10, 5)
    # fig.tight_layout()

plots: dict[str, Axes] = {
    "CPU": axes[0],
    "Server NETIN": axes[1],
    "VMEM": axes[2],
    "RMEM": axes[3],
    "NETIN": axes[4],
    "NETOUT": axes[5],
    "Server NETOUT": axes[6],
}

units = {
    "NET": "Kbps",
    "CPU": "sec",
    "VMEM": "MiB",
    "RMEM": "MiB",
    "NETIN": "Kbps",
    "NETOUT": "Kbps",
    "Server NETIN": "Kbps",
    "Server NETOUT": "Kbps",
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

        v = metric["metric_value"]
        threshold = thresholds.get(name)
        if threshold is not None and len(metric_storage[1]) > 0:
            prevValue = metric_storage[1][-1]
            v = min(v, prevValue + threshold)
            v = max(v, prevValue - threshold)
        metric_storage[0].append(ts)
        metric_storage[1].append(v)

    for metric, (tss, values) in system_metrics.items():
        tss.pop(0)
        values.pop(0)
    for _, metrics in client_metrics_storage.items():
        for _, (tss, values) in metrics.items():
            tss.pop(0)
            values.pop(0)

    return system_metrics, client_metrics_storage


def plot_groups(system_metrics: dict[str, tuple[list[datetime], list[float]]]):
    for name, plot in plots.items():
        plot.set_title(f"{name} stats")
        for metric_name in groups[name]:
            timestamps, metric_values = system_metrics[metric_name]
            if metric_values == []:
                continue
            plot.xaxis.set_major_formatter(DateFormatter("%H:%M"))
            plot.yaxis.set_major_formatter(FormatStrFormatter(f"%.2f {units[name]}"))
            # metric_values = interpolate.splrep(
            #     [ts.timestamp() for ts in timestamps], metric_values, s=S
            # )
            # plot.plot(
            #     timestamps,
            #     interpolate.BSpline(*metric_values)([ts.timestamp() for ts in timestamps]),
            #     label=metric_name,
            #     linestyle="solid",
            # )
            plot.plot(
                timestamps,
                metric_values,
                label=metric_name,
                linestyle="solid",
            )


def plot_client_groups(
    client_id,
    metrics: dict[str, tuple[list[datetime], list[float]]],
):
    if client_id == "":
        return
    for name, plot in plots.items():
        plot.set_title(f"{name} stats")
        for metric_name in groups[name]:
            timestamps, metric_values = metrics[metric_name]
            if metric_values == []:
                continue
            plot.xaxis.set_major_formatter(DateFormatter("%H:%M"))
            plot.yaxis.set_major_formatter(FormatStrFormatter(f"%.2f {units[name]}"))
            plot.plot(
                timestamps,
                metric_values,
                label=f"{metric_name}:{client_id[:6]}",
                linestyle="solid",
            )


def find_closest(
    input_ts: datetime, metricsets: list[tuple[list[datetime], list[float]]]
) -> float:
    to_return = 0
    for tss, metrics in metricsets:
        closest_value = 0
        for ts, v in zip(tss, metrics):
            if ts > input_ts and (ts.timestamp() - input_ts.timestamp()) > 1:
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
            if metric["edge"]["targetId"] == "SFU" or metric["clientId"] == "SFU":
                if metric["edge"]["type_"] == "add":
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


def main():
    metrics = httpx.get(
        "https://collector.webrtc-thesis.ru/metrics/latest", timeout=30
    ).json()
    system_metrics, client_metrics = collect_system_metrics(metrics)
    plot_groups(system_metrics)
    for client_id, client_metrics_ in client_metrics.items():
        plot_client_groups(client_id, client_metrics_)
    for group_name, plot in plots.items():
        metricsets = []
        for metric_name in groups[group_name]:
            metricset = system_metrics[metric_name]
            if metricset != ([], []):
                metricsets.append(metricset)
                continue
            for _, metrics_values in client_metrics.items():
                metricset2 = metrics_values[metric_name]
                if metricset2 != ([], []):
                    metricsets.append(metricset2)

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
    for name, plot in plots.items():
        plot.figure.savefig(name + ".png", dpi=200)
    plt.savefig("a.png", dpi=200)
    plt.show()


if __name__ == "__main__":
    main()
