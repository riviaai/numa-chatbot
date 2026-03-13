#!/bin/bash
# ============================================================
# Nyma (Numerologie Chatbot) Service Manager
# Usage: ./service.sh {start|stop|restart|status|logs}
# ============================================================

SERVICE_NAME="com.nyma.service"
PLIST="$HOME/Library/LaunchAgents/${SERVICE_NAME}.plist"
PORT=3456
APP_DIR="/Users/steven/Medium/numerologie-chatbot"
LOG_DIR="${APP_DIR}/logs"

case "$1" in
  start)
    echo "Starting Nyma service..."
    if launchctl list | grep -q "$SERVICE_NAME"; then
      echo "Service is already loaded. Checking if running..."
      PID=$(lsof -ti tcp:$PORT 2>/dev/null)
      if [ -n "$PID" ]; then
        echo "Already running on port $PORT (PID: $PID)"
        exit 0
      fi
    fi
    launchctl load "$PLIST" 2>/dev/null
    sleep 2
    PID=$(lsof -ti tcp:$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
      echo "Nyma started successfully on port $PORT (PID: $PID)"
    else
      echo "Warning: Service loaded but port $PORT not yet responding. Check logs."
    fi
    ;;

  stop)
    echo "Stopping Nyma service..."
    launchctl unload "$PLIST" 2>/dev/null
    PID=$(lsof -ti tcp:$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null
      sleep 1
      echo "Stopped (PID: $PID)"
    else
      echo "Stopped."
    fi
    ;;

  restart)
    echo "Restarting Nyma service..."
    "$0" stop
    sleep 2
    "$0" start
    ;;

  status)
    PID=$(lsof -ti tcp:$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
      echo "Nyma is RUNNING on port $PORT (PID: $PID)"
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/health" 2>/dev/null)
      if [ "$HTTP_CODE" = "200" ]; then
        echo "Health check: OK (HTTP $HTTP_CODE)"
      else
        echo "Health check: FAILED (HTTP $HTTP_CODE)"
      fi
    else
      echo "Nyma is NOT running."
      if launchctl list | grep -q "$SERVICE_NAME"; then
        echo "LaunchAgent is loaded but process is not running."
      else
        echo "LaunchAgent is not loaded."
      fi
    fi
    ;;

  logs)
    echo "=== Recent stdout ==="
    tail -50 "${LOG_DIR}/nyma-stdout.log" 2>/dev/null || echo "(no stdout log)"
    echo ""
    echo "=== Recent stderr ==="
    tail -50 "${LOG_DIR}/nyma-stderr.log" 2>/dev/null || echo "(no stderr log)"
    ;;

  *)
    echo "Usage: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
