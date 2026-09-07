# Observability

## IDs

request_id
job_id
organization_id
campaign_id
lead_id
provider_request_id

Carry them through API → queue → worker → provider → DB.

## Logs

Structured JSON logs.

## Metrics

- HTTP latency
- queue latency
- processing duration
- AI latency
- provider errors
- DB errors

## Alerts

- queue backlog
- repeated failures
- provider outage
- abnormal outreach rate
- AI cost anomaly
- webhook failure spikes
