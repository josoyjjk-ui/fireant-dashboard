import requests
import time
import csv
import re

BOT_TOKEN = "***REMOVED***"
CHANNEL = "@fireantcrypto"
BASE_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

usernames_raw = """@phoenixtank4925 @lelepepe_0 @Degenoly_eth @k5877 @liberator09 @jameskim290 @lemonaden @yh20210333 @oongtak @hyk_pizza @KQPOS @Zzzzz6946 @immwintery @ASrising @aeri005 @teledooom @pogogosing @OGB0KB @avalihahaha @Nojin11 @kdwpyc @dejavu1271 @eh01psw1 @wseok2527 @lenimas1 @shtlwns @choyangee @cosmolin2 @jurinyee @jungdk @hyeoneybee @alsdnalsdnchl @wvvdamn @ausbro80 @aos9998 @dtanaaa @phyllrar @parkinhwan @junhyeogbong3 @luckyaiden @kimnyang @kanuwithj @hahaha28987 @m8y77 @manggu5079 @tonidong @imk1993 @br21br @hanchals @choey6139 @dhfkapap @shlee1030 @crazymeng @goldkuq @BLO883 @dongtani @bhhb5 @namal111 @passion1507 @Insam_33e @naniR0913 @conshun @dreamrich7 @jschem95 @unic16 @hohoyoung85 @gazua_moodeng @kakemusa @tamay544 @dittosj @jshya0129 @kibok87 @junnss @code42 @okyoung2541 @IVE_L0VE @swg2421 @benzzz9103 @happyman218 @RUNEX76 @younge0703 @wego5m @zhzh7020 @simsimh @jjjjjuuuuu1 @shyesj21 @ych8404 @soonuu77 @dlwpgod @ihs95 @lunacist @kennam1 @letsgodaniel @koss486 @jaint0405 @heshe281104 @camejay98 @sisiar801 @co0692 @newkels @penguin1487 @minluv9212 @bluebird2758 @nolja_1004 @babereto @dkelzzz @jobass98 @mandaringga @soyoung6 @salryo7101 @lollol_1004 @sunginlee @ltm0629 @babi7462 @baekpro @kjy0217 @kimils23 @ad5938 @usehyuk @achist11 @hooaa88 @greenl220 @october972 @eddkimi @hyejinad @qudghks23 @Gycukh @eunseokc @mimijjang @hyen90 @parkgwangeun @kim13the @va412 @chochonacho @onforworld44 @taeddimon @kikimadong @bys16351 @minmsook @FiCriton @cookie852 @ISJPS @miltung @cleanpopup @kim geunho @rodwlek @Kimjun @misty2318 @IloveTloveI @ddd171064 @EEOE2252 @iyum_81 @ysiysiysi @hunterbell10 @포포몬-l9g @wonni_530 @coinshoott @chulmini00 @cold8day @cocorang @pr1me03 @dusrnswn @lacan21 @aegis_llee92 @klaylala @kwng77 @ZeroTo100a @nunssup77 @kam3085 @kangdy70 @dingo2030 @dex1315 @gwakys @ckyung1644 @resurrection1805 @Toboong9 @tt799 @JJJAEKIM @starmoon474 @apple_coffeeee @heedongsister @silverplus81 @panther2593 @signball @Ark_6599 @jaylee0712 @rudtlr2 @deviational77 @heeya_777 @heeya777 @qinq00 @wogns626 @aaron00510 @usingbone @wwxkns @dn0574 @dcdc_dachan @yyssh17 @Nick12479 @heekuenwoo @jade_lee_1 @dionysos1 @asdf55833 @hunters1004 @lmslms1004 @powerwoogi @dudtn2356 @wangtaizi @kimseungbum @bigcat3 @lgelato96344 @lanka7899 @Bongdidi @choks72 @Hellchang2 @nubchee1 @Chris_premier @dhl1013 @JakeAhn7 @Bacu8282 @carryking00 @seoin3116 @ys9510 @bing_skull @dappeum @ys110828 @chuchubang @whdtn100 @accumulate00 @york7979 @raylee0612 @jisu99x @mmhealing @bbuunnd55 @mmommo135 @jakelee01 @dazai0807 @zakeweb3 @joonee2 @donjoang @kh2109 @hsw3137 @imhappy123 @giribi7722 @leehou58 @realbye @cookie1212 @sks760866 @Zinrok @fkfkdkdkfkfk @chanii999 @m9840005 @hosiyuhu @gghost00 @mslim3585 @ygy777333 @kbh1772 @wmdmf2001 @EJseong95 @junghun9512 @anyounggun @Potermon @lhyuns123 @purine22 @lemon3703 @koongya0427 @hiramzi @nys5134 @gibsa4266 @kino5122 @coinhanna @hoon5132 @barnes0303 @ghgffff434 @ampekele @Meentmat @shadeofpuple @RROPEE @lastli13 @Roid7 @PEPPPPEE @jhking01 @BTS_JJANG @NewJeans_NO1 @funjude0 @overveu77 @leeace075 @skygoma062 @ogga2026 @goorm207 @redbeanmouse26 @lucia57109 @clavoscl @sooper507 @skdudm @iankim77 @arang906 @fate3223a @YoooungH @didhkd @markcoin_mk @towol22 @paulus0105 @Soeolinyoung @stg6000 @fackMe0 @wndgml1154 @aosldkgn @cu_ling @gimgihyeok @seoyi @Ssssse222 @soosung2 @Al1ceCrypto @pard231 @nunu7748 @coco4307 @DDODDO10 @suseonKR @jumpletsgo @tinyspoon25 @kimhari07 @bum7120 @Kenekoon @winterferien @wardugwang @hellowbamboo @lsd3372 @aqsw963 @odol2papa @mxl2008 @noon1019 @Bravethecoin3 @youareoo @bravo_sparkling @specialgami3 @irovewoo3 @amongplanet3 @vetataster @Hyeok22222 @patkff @kayi21 @choco3710 @vicshot823 @wemakerove @seik0691 @liveanzel365 @envision82 @fucucuu3 @sx33ss3ss @urinarylol @OndineVale @ccczzvxvx @tavren9402 @moxira721 @xtt5xx5 @bendrix4217 @po2love322 @lanxor835 @vvvvcczcc @iouiouiouiou7 @godsaveusnow7 @sjlovelove333 @gotbless77 @comwai83 @gamision7 @trulypunch @gutkeine @yepysun @suisolgo @jmn2823 @nullumcri @sunrise0227 @koras2233 @juliakimma @jasontori @successkey0219 @dry9090 @zinzin195 @pcmnet @chomi22 @dndka2 @hungrysiro @cutiro6534 @lsw828287 @gdfghb54 @Dolssaa @rdgb345 @kdh9526 @hkhksoo @pakurri @ansondin @gusdnd428 @ohs099 @limhwan @bbng3353 @pudadakk @Rhralska77 @chaedog @lga25438 @nainua @sldaosdl @aiforex12 @hayans13 @yulriS2 @ggolaji @gan092 @mempop21 @gopen0010 @yskin7 @kchoonsik @choi5394 @seok5394 @jobass98 @darkah2 @brothers0824 @kc3584 @sdsd55565 @karf5115 @ddiyo903 @kjhrpg1 @qk0075 @Chaesigi @Xero @hanjjong0 @minhyeon97 @kim3116 @cheezebz @Matizyay @nishane_wulong @raviaviyo @raikas1 @jy1023 @Kkuikk @boae804 @mmrjung @ycw7134 @sjclever14 @sora2199 @drogba122 @SkywalkerC @clouddrift @camaro999"""

def parse_usernames(raw):
    tokens = raw.split()
    result = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t.startswith('@'):
            uname = t[1:]
            # 한글·공백 등 무효 username은 스킵
            if re.match(r'^[A-Za-z0-9_]{4,32}$', uname):
                result.append(uname)
            else:
                result.append(f"INVALID:{uname}")
        i += 1
    return result

def get_user_id(username):
    """getChat으로 username → user_id 해석"""
    try:
        r = requests.get(f"{BASE_URL}/getChat", params={"chat_id": f"@{username}"}, timeout=10)
        data = r.json()
        if data.get("ok"):
            return data["result"].get("id")
    except:
        pass
    return None

def check_member(user_id):
    """getChatMember로 채널 입장 여부 확인"""
    try:
        r = requests.get(f"{BASE_URL}/getChatMember", params={
            "chat_id": CHANNEL,
            "user_id": user_id
        }, timeout=10)
        data = r.json()
        if data.get("ok"):
            status = data["result"].get("status", "")
            return status in ("member", "administrator", "creator", "restricted")
        else:
            err = data.get("description", "")
            if "not found" in err.lower() or "user not found" in err.lower():
                return False
            if "chat not found" in err.lower():
                return False
    except:
        pass
    return None

usernames = parse_usernames(usernames_raw)

results = []
eligible = []
ineligible = []
invalid = []

print(f"총 {len(usernames)}개 처리 시작...")

for i, u in enumerate(usernames):
    if u.startswith("INVALID:"):
        actual = u.replace("INVALID:", "")
        results.append((f"@{actual}", "형식오류", "부적격"))
        invalid.append(actual)
        print(f"[{i+1}/{len(usernames)}] @{actual} → 형식오류")
        continue

    # Step1: username → user_id
    uid = get_user_id(u)
    if uid is None:
        results.append((f"@{u}", "계정없음/비공개", "부적격"))
        ineligible.append(u)
        print(f"[{i+1}/{len(usernames)}] @{u} → 계정없음")
        time.sleep(0.3)
        continue

    # Step2: 채널 멤버십 확인
    is_member = check_member(uid)
    if is_member is True:
        results.append((f"@{u}", "멤버확인", "적격"))
        eligible.append(u)
        print(f"[{i+1}/{len(usernames)}] @{u} → ✅ 적격")
    elif is_member is False:
        results.append((f"@{u}", "미입장", "부적격"))
        ineligible.append(u)
        print(f"[{i+1}/{len(usernames)}] @{u} → ❌ 부적격")
    else:
        results.append((f"@{u}", "확인불가", "부적격"))
        ineligible.append(u)
        print(f"[{i+1}/{len(usernames)}] @{u} → ⚠️ 확인불가")

    time.sleep(0.35)  # 429 방지

# CSV 저장
with open("/Users/fireant/.openclaw/workspace/member_check_result.csv", "w", newline="", encoding="utf-8-sig") as f:
    writer = csv.writer(f)
    writer.writerow(["텔레그램ID", "상태", "판정"])
    writer.writerows(results)

print(f"\n=== 완료 ===")
print(f"적격: {len(eligible)}명")
print(f"부적격: {len(ineligible)}명")
print(f"형식오류: {len(invalid)}개")
print(f"결과 저장: member_check_result.csv")
