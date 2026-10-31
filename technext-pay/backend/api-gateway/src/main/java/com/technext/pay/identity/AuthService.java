package com.technext.pay.identity;

import org.springframework.security.crypto.password.PasswordEncoder; import org.springframework.stereotype.Service; import org.springframework.transaction.annotation.Transactional;
import java.security.SecureRandom; import java.util.HexFormat; import java.util.Locale;

@Service public class AuthService {
    private final MerchantRepository merchants; private final MerchantUserRepository users; private final ApiCredentialRepository credentials; private final PasswordEncoder passwords; private final JwtService jwt; private final SecureRandom random=new SecureRandom();
    public AuthService(MerchantRepository m,MerchantUserRepository u,ApiCredentialRepository c,PasswordEncoder p,JwtService j){merchants=m;users=u;credentials=c;passwords=p;jwt=j;}
    @Transactional public SignupResult signup(String legalName,String email,String phone,String password){
        String normalized=email.trim().toLowerCase(Locale.ROOT); if(users.existsByEmailIgnoreCase(normalized))throw new ConflictException("email_already_registered");
        Merchant merchant=merchants.save(new Merchant(legalName.trim())); MerchantUser user=users.save(new MerchantUser(merchant,normalized,phone,passwords.encode(password)));
        String secret="tn_test_sec_"+randomHex(32), publicKey="tn_test_pub_"+randomHex(16); credentials.save(new ApiCredential(merchant,publicKey,sha256(secret)));
        return new SignupResult(jwt.issue(user.getId()),merchant.getId(),merchant.getLegalName(),merchant.getStatus().name(),publicKey,secret,"TEST");
    }
    @Transactional(readOnly=true) public SignupResult login(String email,String password){MerchantUser user=users.findFirstByEmailIgnoreCase(email.trim()).filter(u->passwords.matches(password,u.getPasswordHash())).orElseThrow(()->new UnauthorizedException("invalid_credentials"));return new SignupResult(jwt.issue(user.getId()),user.getMerchant().getId(),user.getMerchant().getLegalName(),user.getMerchant().getStatus().name(),null,null,"TEST");}
    static String sha256(String value){try{return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private String randomHex(int bytes){byte[] value=new byte[bytes];random.nextBytes(value);return HexFormat.of().formatHex(value);}
    public record SignupResult(String accessToken,java.util.UUID merchantId,String merchantName,String merchantStatus,String testPublicKey,String testSecretKey,String environment){}
    public static class ConflictException extends RuntimeException{public ConflictException(String m){super(m);}} public static class UnauthorizedException extends RuntimeException{public UnauthorizedException(String m){super(m);}}
}

