package com.technext.pay.identity;

import jakarta.validation.Valid; import jakarta.validation.constraints.*; import org.springframework.http.HttpStatus; import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/api/v1/auth") public class AuthController {
    private final AuthService auth; public AuthController(AuthService auth){this.auth=auth;}
    @PostMapping("/signup") @ResponseStatus(HttpStatus.CREATED) public AuthService.SignupResult signup(@Valid @RequestBody SignupRequest request){return auth.signup(request.legalBusinessName(),request.email(),request.phone(),request.password());}
    @PostMapping("/login") public AuthService.SignupResult login(@Valid @RequestBody LoginRequest request){return auth.login(request.email(),request.password());}
    public record SignupRequest(@NotBlank @Size(max=200) String legalBusinessName,@NotBlank @Email @Size(max=254) String email,@NotBlank @Pattern(regexp="^\\+?[0-9]{8,15}$") String phone,@NotBlank @Size(min=12,max=72) String password){}
    public record LoginRequest(@NotBlank @Email String email,@NotBlank String password){}
}

