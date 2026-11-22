#!/bin/bash
set -eu

input_lock=/tmp/pero-desktop-input.lock
case "${1:-start}" in
    observe) exec socat STDIO TCP4:127.0.0.1:5900 ;;
    control) exec flock -n -o "$input_lock" socat STDIO TCP4:127.0.0.1:5901 ;;
    computer) exec flock -n -o "$input_lock" /usr/local/bin/pero-computer ;;
    input-idle) exec flock -w 4 -o "$input_lock" true ;;
    probe)
        xdpyinfo >/dev/null 2>&1 &&
            timeout 2 bash -c 'read -r -N 4 greeting </dev/tcp/127.0.0.1/5900 && [[ $greeting == "RFB " ]]' &&
            timeout 2 bash -c 'read -r -N 4 greeting </dev/tcp/127.0.0.1/5901 && [[ $greeting == "RFB " ]]'
        exit ;;
    start) ;;
    *) exit 2 ;;
esac

Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp -noreset &
xvfb=$!
critical=("$xvfb")
for (( i=0; i<100; i++ )); do
    if xdpyinfo >/dev/null 2>&1; then break; fi
    kill -0 "$xvfb"
    sleep 0.05
done
xdpyinfo >/dev/null

dbus-daemon --session --nofork --address="$DBUS_SESSION_BUS_ADDRESS" &
critical+=("$!")
openbox &
critical+=("$!")
mousepad &
x11vnc -localhost -rfbport 5900 -viewonly -forever -shared -nopw -noxdamage -noremote -nosel &
critical+=("$!")
x11vnc -localhost -rfbport 5901 -forever -shared -nopw -noxdamage -noremote -nosel -clear_all &
critical+=("$!")
trap 'kill $(jobs -pr) 2>/dev/null || true' EXIT
trap 'exit 0' TERM INT
wait -n "${critical[@]}"
