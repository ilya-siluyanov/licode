result=()

for pid in $(ps aux | grep -E "initBasicExample|initNuve|initErizo_controller|initErizo_agent" | awk '{print $2}' | tail -n+1)
do
    result+=($pid)
done

for pid in $(lsof -i :8080 -i :3000 -i :3001 | awk '{print $2}' | tail -n+2)
do
    result+=($pid)
done

for pid in $(ps aux | grep erizo | awk '{print $2}' | tail -n+1)
do
    result+=($pid)
done

# for pid in $(ps aux | grep rabbit | awk '{print $2}' | tail -n+1)
# do
#     result+=($pid)
# done

echo ${result[@]}
