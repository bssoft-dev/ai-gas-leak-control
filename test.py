from openai import OpenAI
client = OpenAI(base_url="http://0.0.0.0:8000/v1", api_key="not-used")
messages = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": "What is in this image?"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://assets.ngc.nvidia.com/products/api-catalog/phi-3-5-vision/example1b.jpg"
                }
            }
        ]
    }
]
chat_response = client.chat.completions.create(
    model="mistralai/ministral-3-14b-instruct-2512",
    messages=messages,
    max_tokens=256,
    stream=False
)
assistant_message = chat_response.choices[0].message
print(assistant_message)