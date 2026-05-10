curl 'https://search.bytedance.net/gpt/openapi/online/v2/crawl?ak=5Tbfs4d7ysO2fI7saWuyT4kRa3rv0NXe_GPT_AK' \
-H 'Content-Type: application/json' \
-H "Authorization: Bearer ${V_API_KEY}" \
-d '{                                                                                    
"model": "gpt-5.5-2026-04-24",                                                         
"messages": [                                                                          
    { "role": "user", "content": "ping" }                                                
]                                                                                      
}'  