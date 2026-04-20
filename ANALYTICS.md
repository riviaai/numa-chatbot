# Numa Analytics API

## Overview

Numa now includes built-in analytics tracking to monitor user engagement and popular numerological interests.

## Features

### Analytics Tracking
- **Total Conversations**: Count of unique chat sessions started
- **Total Messages**: Cumulative number of messages sent (user + bot)
- **Messages Per Session**: Average conversation length
- **Daily Active Users**: Unique users per day
- **Birth Dates**: Track most popular birth dates queried
- **Auto-save**: Analytics saved every 5 minutes + on shutdown

### Data Storage
All analytics are stored in `/data/analytics.json` with the following structure:

```json
{
  "totalConversationsStarted": 42,
  "totalMessages": 256,
  "birthDates": {
    "24/06/1990": 3,
    "15/03/1985": 2
  },
  "dailyActiveUsers": {
    "2026-03-17": ["session_abc123", "session_def456"],
    "2026-03-16": ["session_ghi789"]
  }
}
```

## API Endpoint

### GET `/api/stats`

Retrieve analytics in JSON format.

**Query Parameters:**
- `key` (optional): Admin key for access control

**Example:**
```bash
# Without authentication (development mode)
curl http://localhost:3456/api/stats

# With authentication (production)
curl "http://localhost:3456/api/stats?key=YOUR_ADMIN_KEY"
```

**Response:**
```json
{
  "totalConversationsStarted": 42,
  "totalMessages": 256,
  "avgMessagesPerSession": 6.1,
  "dailyActiveUsers": {
    "2026-03-17": ["session_abc123", "session_def456"],
    "2026-03-16": ["session_ghi789"]
  },
  "totalUniqueActiveUsers": 3,
  "topBirthDates": [
    { "date": "24/06/1990", "count": 3 },
    { "date": "15/03/1985", "count": 2 }
  ],
  "timestamp": "2026-03-17T14:32:00.000Z"
}
```

## Security

### Admin Key Configuration

To restrict access to the `/api/stats` endpoint, set the `ADMIN_KEY` environment variable:

```bash
# In .env
ADMIN_KEY=your_secret_admin_key_here
```

**Access Control Behavior:**
- If `ADMIN_KEY` is NOT set → Endpoint is public (development mode)
- If `ADMIN_KEY` IS set → Admin key is required in query string
  - Missing key → 403 Forbidden
  - Invalid key → 403 Forbidden

### Best Practices

1. **Use strong admin keys** in production (32+ random characters)
2. **Do not expose keys** in version control (use .env)
3. **Rotate keys periodically** for security
4. **Monitor access logs** if deployed with authentication

## Use Cases

### User Engagement Tracking
```bash
curl http://localhost:3456/api/stats | jq '.totalConversationsStarted'
```

### Popular Birth Dates
```bash
curl http://localhost:3456/api/stats | jq '.topBirthDates'
```

### Daily Active Users
```bash
curl http://localhost:3456/api/stats | jq '.dailyActiveUsers["2026-03-17"] | length'
```

## Data Privacy

- ⚠️ Birth dates are stored and can be extracted via `/api/stats`
- Session IDs are stored to track daily active users
- Consider GDPR compliance when displaying or exporting analytics
- No personally identifiable information (PII) beyond birth dates is stored
- Consider implementing data retention/deletion policies

## Notes

- Analytics are auto-saved every 5 minutes
- Analytics are also saved on graceful server shutdown (SIGTERM/SIGINT)
- Session IDs are random and non-sequential (`session_[random]`)
- Daily active users count is cumulative per day (may include returning users)
