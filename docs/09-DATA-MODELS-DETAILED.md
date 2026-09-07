# Detailed Data Models

## Lead

Fields:
id, organization_id, canonical_name, category, address, city, region, country,
latitude, longitude, phone, website, source, source_external_id, source_url,
verification_status, verification_score, contactability_score, lead_score,
temperature, status, created_at, updated_at.

## Evidence

id, lead_id, type, statement, source, source_url, confidence, observed_at, expires_at.

## IntelligenceReport

id, lead_id, version, summary, strengths_json, pain_points_json,
opportunities_json, recommended_angle, objections_json, confidence,
model, prompt_version, schema_version, created_at.

## LeadScore

id, lead_id, total, fit, opportunity, contactability, maturity, confidence,
urgency, explanation_json, model, version.

## MessageDraft

id, lead_id, channel, sequence_step, body, model, prompt_version,
validation_status, validation_errors, created_at, approved_at.

## Conversation

id, lead_id, channel, status, created_at, updated_at.

## Message

id, conversation_id, direction, body, provider_message_id,
classification_json, sent_at, received_at.
