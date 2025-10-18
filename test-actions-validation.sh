#!/bin/bash

# Тест 1: Workflow.DuplicateAndPauseOriginal
echo "=== Test 1: Workflow.DuplicateAndPauseOriginal ==="
curl -sS -X POST localhost:8080/api/agent/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-dup-pause-001",
    "source": "test",
    "account": {"userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"},
    "actions": [{
      "type": "Workflow.DuplicateAndPauseOriginal",
      "params": {
        "campaign_id": "120234844633250463",
        "name": "TEST DUP"
      }
    }]
  }' | jq '{ok: .executionId, error}'

echo ""
echo "=== Test 2: Workflow.DuplicateKeepOriginalActive ==="
curl -sS -X POST localhost:8080/api/agent/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-dup-keep-002",
    "source": "test",
    "account": {"userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"},
    "actions": [{
      "type": "Workflow.DuplicateKeepOriginalActive",
      "params": {
        "campaign_id": "120234844633250463",
        "name": "TEST SCALE"
      }
    }]
  }' | jq '{ok: .executionId, error}'

echo ""
echo "=== Test 3: Audience.DuplicateAdSetWithAudience ==="
curl -sS -X POST localhost:8080/api/agent/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "idempotencyKey": "test-aud-dup-003",
    "source": "test",
    "account": {"userAccountId": "0f559eb0-53fa-4b6a-a51b-5d3e15e5864b"},
    "actions": [{
      "type": "Audience.DuplicateAdSetWithAudience",
      "params": {
        "source_adset_id": "120234845322690463",
        "audience_id": "123456789",
        "daily_budget": 1000,
        "name_suffix": "LAL3 TEST"
      }
    }]
  }' | jq '{ok: .executionId, error}'
