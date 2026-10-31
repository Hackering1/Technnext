package com.technext.pay.identity;

import jakarta.servlet.*; import jakarta.servlet.http.*; import org.springframework.security.authentication.UsernamePasswordAuthenticationToken; import org.springframework.security.core.authority.SimpleGrantedAuthority; import org.springframework.security.core.context.SecurityContextHolder; import org.springframework.stereotype.Component; import org.springframework.web.filter.OncePerRequestFilter; import java.io.IOException; import java.util.List;
@Component public class MerchantAuthFilter extends OncePerRequestFilter {
    private final JwtService jwt;private final MerchantUserRepository users;private final ApiCredentialRepository credentials;
    public MerchantAuthFilter(JwtService j,MerchantUserRepository u,ApiCredentialRepository c){jwt=j;users=u;credentials=c;}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
        String header=request.getHeader("Authorization");
        if(header!=null&&header.startsWith("Bearer ")){String token=header.substring(7);try{
            MerchantPrincipal principal;
            if(token.startsWith("tn_test_sec_")){ApiCredential key=credentials.findBySecretHashAndRevokedAtIsNull(AuthService.sha256(token)).orElseThrow();principal=new MerchantPrincipal(key.getMerchant().getId(),null,"MERCHANT_OWNER",key.getEnvironment());}
            else {MerchantUser user=users.findById(jwt.verify(token)).orElseThrow();principal=new MerchantPrincipal(user.getMerchant().getId(),user.getId(),user.getRole(),"TEST");}
            var auth=new UsernamePasswordAuthenticationToken(principal, null, List.of(new SimpleGrantedAuthority("ROLE_"+principal.role())));SecurityContextHolder.getContext().setAuthentication(auth);
        }catch(RuntimeException ignored){SecurityContextHolder.clearContext();}}
        chain.doFilter(request,response);
    }
}

