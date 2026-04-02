from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/chat', methods=['POST'])
def chat():
    print("Received inference request:", request.json, flush=True)
    return jsonify({
        "choices": [
            {
                "message": {
                    "role": "assistant",
                    "content": "Real Inference via Sidecar Proxy!"
                }
            }
        ]
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
