import json


def print_pretty(event):
    for key, value in event.items():
        print(
            f"  • {key}: {json.dumps(value, indent=2) if isinstance(value, dict) else value}"
        )


def handler(event, context):
    print(context)
    print("📦 Received Event:")
    print_pretty(event)

    detail_type = event.get("detail-type", "Unknown")
    source = event.get("source", "Unknown")
    detail = event.get("detail", {})

    print(f"🔍 Event Type: {detail_type}")
    print(f"🔗 Source: {source}")
    print("🧾 Detail Payload:")
    print_pretty(detail)

    return {
        "statusCode": 200,
        "headers": {
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "OPTIONS,POST,GET",
        },
        "body": json.dumps("Hello from your new Amplify Python lambda!"),
    }
