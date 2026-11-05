# QA evidence: PR #225 at 0c950461

## Edge cases (fake Slack, core harness): 7 pass, 0 fail

```
QA archive thread: [["​*<https://ren.test/app/tasks/ORG_01M6P4Y30DS5TQQT21W1J4S79H-1|ORG_01M6P4Y30DS5TQQT21W1J4S79H-1>*​ Archive me · Archived","Archived"]]
QA review thread: [["​*<https://ren.test/app/tasks/ORG_01M6P4Y50E3RW1DZNGZ91EMW79-1|ORG_01M6P4Y50E3RW1DZNGZ91EMW79-1>*​ Review me · To do","To do",{"task_id":"tsk_01M6P4Y517V3P3TDCKB45945H6","kind":"card"}],["Needs a person: Please check <https://ren.test/app/tasks/tsk_01M6P4Y517V3P3TDCKB45945H6|Open the task>","To do",{"task_id":"tsk_01M6P4Y517V3P3TDCKB45945H6","kind":"notice"}]]
QA owner: "usr_01M6P4Y6K9CAAAFA7BS3MRTX7R"
QA merge thread: [["​*<https://ren.test/app/tasks/ORG_01M6P4Y6K7A2DCAWG39FXZAQW1-1|ORG_01M6P4Y6K7A2DCAWG39FXZAQW1-1>*​ Merge me · Done","Done"],["<@UGRACE> Done. <https://ren.test/app/tasks/tsk_01M6P4Y6KZ050W0CGWZCJYWYFY|Open the task>","Done"]]
QA own: [["​*<https://ren.test/app/tasks/ORG_01M6P4Y7HB3YDDPRXXCD8SYY8W-1|ORG_01M6P4Y7HB3YDDPRXXCD8SYY8W-1>*​ Do it · Done","Done"]]
QA other: [["​*<https://ren.test/app/tasks/ORG_01M6P4Y7HB3YDDPRXXCD8SYY8W-1|ORG_01M6P4Y7HB3YDDPRXXCD8SYY8W-1>*​ Do it · Done","Done"],["Done. <https://ren.test/app/tasks/tsk_01M6P4Y7J20S9JSWP44VN3SM52|Open the task>","Done"]]
QA other-space thread: [["​*<https://ren.test/app/tasks/ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1|ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1>*​ · To do","ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1"],["Needs a person: Look <https://ren.test/app/tasks/tsk_01M6P4Y8FXVB0PVZ9A1B00Z9QB|Open the task>","ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1"]]
QA details without channel: "{\"entity_type\":\"slack#/entities/task\",\"url\":\"https://ren.test/app/tasks/ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1\",\"external_ref\":{\"id\":\"tsk_01M6P4Y8FXVB0PVZ9A1B00Z9QB\"},\"entity_payload\":{\"attributes\":{\"title\":{\"text\":\"ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1\"},\"display_id\":\"ORG_01M6P4Y8F8FHYVZDBWTAG8AFWK-1\",\"metada"
QA unfurl: [["https://ren.test/app/tasks/org_01m6p4y9dq1cycr1s2ttz7xyph-1","tsk_01M6P4Y9EKG42V5NK8E7H773AJ","Mine"],["https://ren.test/app/tasks/ORG_01M6P4Y9DQ1CYCR1S2TTZ7XYPH-1/","tsk_01M6P4Y9EKG42V5NK8E7H773AJ","Mine"]]
 7 pass
 0 fail
```

## Real Slack (dev app, #ren-slack-tests): SlackTaskCard + ChannelNotice + Task against slack.com

Thread: https://ren-5oi2082.slack.com/archives/C0B7P9AV03F/p1793892152602669

```json
[
  {
    "thread": "C0B7P9AV03F:1793892152.602669"
  },
  {
    "step": "1 created",
    "messages": [
      {
        "ts": "1793892152.955519",
        "text": "*<https://ren.test/app/tasks/ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1|ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1>* QA: Slack task card · To do",
        "edited": false,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "card"
        },
        "entities": 0,
        "mention": false
      }
    ]
  },
  {
    "step": "2 in_progress",
    "messages": [
      {
        "ts": "1793892152.955519",
        "text": "*<https://ren.test/app/tasks/ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1|ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1>* QA: Slack task card · In progress",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "card"
        },
        "entities": 0,
        "mention": false
      }
    ]
  },
  {
    "step": "3 review requested",
    "messages": [
      {
        "ts": "1793892152.955519",
        "text": "*<https://ren.test/app/tasks/ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1|ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1>* QA: Slack task card · In progress",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "card"
        },
        "entities": 0,
        "mention": false
      },
      {
        "ts": "1793892159.063959",
        "text": "<@U0CEJKSUH0B> Needs a person: QA asks for a person. <https://ren.test/app/tasks/tsk_01M6P4VX9PZ39R7C4DQSBC4M1F|Open the task>",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "notice"
        },
        "entities": 0,
        "mention": true
      }
    ]
  },
  {
    "step": "4 review decided",
    "messages": [
      {
        "ts": "1793892152.955519",
        "text": "*<https://ren.test/app/tasks/ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1|ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1>* QA: Slack task card · In progress",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "card"
        },
        "entities": 0,
        "mention": false
      },
      {
        "ts": "1793892159.063959",
        "text": "<@U0CEJKSUH0B> Needs a person: QA asks for a person. <https://ren.test/app/tasks/tsk_01M6P4VX9PZ39R7C4DQSBC4M1F|Open the task>",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "notice"
        },
        "entities": 0,
        "mention": true
      }
    ]
  },
  {
    "step": "5 done",
    "messages": [
      {
        "ts": "1793892152.955519",
        "text": "*<https://ren.test/app/tasks/ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1|ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1>* QA: Slack task card · Done",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "card"
        },
        "entities": 0,
        "mention": false
      },
      {
        "ts": "1793892159.063959",
        "text": "<@U0CEJKSUH0B> Needs a person: QA asks for a person. <https://ren.test/app/tasks/tsk_01M6P4VX9PZ39R7C4DQSBC4M1F|Open the task>",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "notice"
        },
        "entities": 0,
        "mention": true
      },
      {
        "ts": "1793892165.449849",
        "text": "<@U0CEJKSUH0B> Done. <https://ren.test/app/tasks/tsk_01M6P4VX9PZ39R7C4DQSBC4M1F|Open the task>",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "notice"
        },
        "entities": 0,
        "mention": true
      }
    ]
  },
  {
    "step": "6 archived",
    "messages": [
      {
        "ts": "1793892152.955519",
        "text": "*<https://ren.test/app/tasks/ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1|ORG_01M6P4VWR1KKM9HJN7PJQVPCV6-1>* QA: Slack task card · Archived",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "card"
        },
        "entities": 0,
        "mention": false
      },
      {
        "ts": "1793892159.063959",
        "text": "<@U0CEJKSUH0B> Needs a person: QA asks for a person. <https://ren.test/app/tasks/tsk_01M6P4VX9PZ39R7C4DQSBC4M1F|Open the task>",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "notice"
        },
        "entities": 0,
        "mention": true
      },
      {
        "ts": "1793892165.449849",
        "text": "<@U0CEJKSUH0B> Done. <https://ren.test/app/tasks/tsk_01M6P4VX9PZ39R7C4DQSBC4M1F|Open the task>",
        "edited": true,
        "event_type": "ren_task_card",
        "payload": {
          "task_id": "tsk_01M6P4VX9PZ39R7C4DQSBC4M1F",
          "kind": "notice"
        },
        "entities": 0,
        "mention": true
      }
    ]
  },
  {
    "slackCalls": [
      {
        "method": "conversations.replies",
        "ok": true
      },
      {
        "method": "chat.postMessage",
        "ok": true
      },
      {
        "method": "conversations.replies",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.postMessage",
        "ok": true
      },
      {
        "method": "conversations.replies",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "conversations.replies",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.postMessage",
        "ok": true
      },
      {
        "method": "conversations.replies",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "conversations.replies",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      },
      {
        "method": "chat.update",
        "ok": true
      }
    ]
  }
]```
