package com.technext.pay.config;
import com.technext.pay.identity.MerchantAuthFilter; import org.springframework.boot.web.servlet.FilterRegistrationBean; import org.springframework.context.annotation.*; import org.springframework.security.config.annotation.web.builders.HttpSecurity; import org.springframework.security.config.http.SessionCreationPolicy; import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder; import org.springframework.security.crypto.password.PasswordEncoder; import org.springframework.security.web.SecurityFilterChain; import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
@Configuration public class SecurityConfig {
 @Bean PasswordEncoder passwordEncoder(){return new BCryptPasswordEncoder(12);}
 @Bean FilterRegistrationBean<MerchantAuthFilter> disableContainerFilterRegistration(MerchantAuthFilter filter){FilterRegistrationBean<MerchantAuthFilter> registration=new FilterRegistrationBean<>(filter);registration.setEnabled(false);return registration;}
 @Bean SecurityFilterChain security(HttpSecurity http,MerchantAuthFilter authFilter)throws Exception{return http.csrf(c->c.disable()).sessionManagement(s->s.sessionCreationPolicy(SessionCreationPolicy.STATELESS)).authorizeHttpRequests(a->a.requestMatchers("/api/v1/auth/**","/actuator/health/**").permitAll().anyRequest().authenticated()).addFilterBefore(authFilter,UsernamePasswordAuthenticationFilter.class).build();}
}

