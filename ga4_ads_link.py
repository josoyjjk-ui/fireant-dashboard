#!/usr/bin/env python3
"""
GA4 ↔ Google Ads 링크 생성 + 전환 import 설정
실행 전: python3 ga4_auth.py 로 먼저 인증 필요
"""
import json, requests
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

# ====== 설정값 ======
GA4_MEASUREMENT_ID = "G-LCYQQE3T5B"
GOOGLE_ADS_CUSTOMER_ID = "6760095668"  # 하이픈 제거
GA4_TOKEN_FILE = "/Users/fireant/.openclaw/workspace/secrets/ga4-token.json"
# ====================

def get_creds():
    with open(GA4_TOKEN_FILE) as f:
        token_data = json.load(f)
    creds = Credentials(
        token=token_data.get('token'),
        refresh_token=token_data.get('refresh_token'),
        token_uri=token_data.get('token_uri'),
        client_id=token_data.get('client_id'),
        client_secret=token_data.get('client_secret'),
        scopes=token_data.get('scopes'),
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return creds

def get_headers(creds):
    return {'Authorization': f'Bearer {creds.token}', 'Content-Type': 'application/json'}

def find_property(creds):
    """측정 ID로 GA4 Property 찾기"""
    headers = get_headers(creds)
    resp = requests.get('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', headers=headers)
    data = resp.json()
    
    for account in data.get('accountSummaries', []):
        for prop in account.get('propertySummaries', []):
            # property name은 properties/XXXXXXX 형식
            prop_name = prop.get('property', '')
            prop_id = prop_name.split('/')[-1] if prop_name else ''
            
            # data streams 확인
            streams_resp = requests.get(
                f'https://analyticsadmin.googleapis.com/v1beta/{prop_name}/dataStreams',
                headers=headers
            )
            for stream in streams_resp.json().get('dataStreams', []):
                web_info = stream.get('webStreamData', {})
                if web_info.get('measurementId') == GA4_MEASUREMENT_ID:
                    print(f"✅ Found property: {prop_name} (Account: {account.get('account')})")
                    return prop_name
    return None

def create_google_ads_link(creds, property_name):
    """GA4에 Google Ads 링크 생성"""
    headers = get_headers(creds)
    
    # 기존 링크 확인
    resp = requests.get(
        f'https://analyticsadmin.googleapis.com/v1beta/{property_name}/googleAdsLinks',
        headers=headers
    )
    existing = resp.json().get('googleAdsLinks', [])
    
    for link in existing:
        if GOOGLE_ADS_CUSTOMER_ID in link.get('customerId', ''):
            print(f"✅ Google Ads 링크 이미 존재: {link.get('name')}")
            return link
    
    # 새 링크 생성
    payload = {
        "customerId": GOOGLE_ADS_CUSTOMER_ID,
        "adsPersonalizationEnabled": True,
    }
    resp = requests.post(
        f'https://analyticsadmin.googleapis.com/v1beta/{property_name}/googleAdsLinks',
        headers=headers,
        json=payload
    )
    
    if resp.status_code in (200, 201):
        link = resp.json()
        print(f"✅ Google Ads 링크 생성 완료: {link.get('name')}")
        return link
    else:
        print(f"❌ 링크 생성 실패: {resp.status_code} - {resp.text}")
        return None

def main():
    print("=== GA4 ↔ Google Ads 링크 설정 ===")
    
    try:
        creds = get_creds()
        print("✅ 인증 성공")
    except Exception as e:
        print(f"❌ 인증 실패: {e}")
        print("먼저 python3 ga4_auth.py 를 실행해 주세요.")
        return
    
    # Property 찾기
    property_name = find_property(creds)
    if not property_name:
        print("❌ GA4 Property를 찾을 수 없습니다.")
        print(f"   측정 ID {GA4_MEASUREMENT_ID}가 있는 property가 없거나 권한이 없습니다.")
        return
    
    # Google Ads 링크 생성
    link = create_google_ads_link(creds, property_name)
    if not link:
        return
    
    print("\n=== 완료 ===")
    print(f"Property: {property_name}")
    print(f"Google Ads Link: {json.dumps(link, indent=2, ensure_ascii=False)}")
    print("\n📌 다음 단계 (Google Ads 콘솔에서 수동 작업):")
    print("1. Google Ads 콘솔 → 도구 → 전환 → 새 전환 액션")
    print("2. 소스: Google Analytics 4 속성")
    print("3. reserve_submit → '예약 신청' 전환 액션으로 import")
    print("4. kakao_chat_click → '카카오 상담 클릭' 전환 액션으로 import")

if __name__ == '__main__':
    main()
