import passport from "passport";
import local from "passport-local";
import jwt from 'passport-jwt';
import GitHubStrategy from 'passport-github2';
import { userService, cartService } from "../services/index.js";
import {cookieExtractor , createHash , isValidPassword} from '../../utils.js'
import config from './config.js'

import CustomError from "../services/errors/CustomError.js";
import EErrors from "../services/errors/enums.js";
import { generateUserErrorInfo } from "../services/errors/info.js";


const admin = {
    first_name: 'Ventura',
    last_name: 'Admin',
    email: config.ADMIN_EMAIL,
    password: config.ADMIN_PASSWORD,
    role: 'admin'
};

const LocalStrategy = local.Strategy;
const JWTStrategy = jwt.Strategy;
const ExtractJWT = jwt.ExtractJwt;

const initializePassport = async () => {
    passport.use('register', new LocalStrategy(
        {passReqToCallback:true , usernameField: 'email' , session:false }, async (req, username, password, done) => {
            const {first_name, last_name, email, age} = req.body; 
            req.logger.info(`Passport - Registrando nuevo usuario con email: ${email}`);

            try {
                if (!first_name || !last_name || !email || !age) {
                    CustomError.createError({
                        name:"User creation error",
                        cause: generateUserErrorInfo({first_name,last_name,email,age}),
                        message: "Error Trying to create User",
                        code: EErrors.INVALID_TYPES_ERROR
                    })
                    req.logger.error('Passport - Valores incompletos para el registro de usuario');
                    return done(null, false, { message: 'Incomplete Values' });
                }
                let exist = await userService.getUserByEmail(username);
                if(exist){
                    req.logger.warning('Passport - El usuario ya existe');
                    return done(null, false, { message: 'User already exists' });
                }
                const newUser = {
                    first_name, 
                    last_name, 
                    email, 
                    age,
                    cart: await cartService.createCart(),
                    password: createHash(password),
                }
                let result = await userService.addUser(newUser);
                req.logger.info(`Passport - Usuario registrado con éxito: ${email}`);
                return done(null,result); 
            } catch (error) {
                req.logger.error(`Passport - Error al obtener el usuario: ${error}`);
                return done('Error al obtener el usuario:' + error)   
            }
        }
    ))
        
    passport.use('login', new LocalStrategy({ 
        usernameField: 'email', 
        session: false, 
    }, async (username, password, done) => {
        try {
            if (username === admin.email && password === admin.password) {
                const adminUser = admin
                return done(null, adminUser)
            }
            //Si se quiere loguear un usuario comun:
            //const user = await userModel.findOne({email:username}) //busca el usuario ingresado por su email
            const user = await userService.getUserByEmail(username) //busca el usuario ingresado por su email
            if(!user){
                // si el usuario no existe envia un error.
                return done(null, false ,{message: "No se encontro el usuario"}); // no se le envia un usuario = (false)
            }
            if(!isValidPassword(user,password)){
                return done(null, false , {message: "Contraseña incorrecta"}) // si la contraseña es incorrecta, tampoco se le envia un usuario = (false).
            };
            return done(null, user); // se le envia el usuario en forma de objeto con todos sus datos como sale de la base de datos = {user}
        } catch (error) {
            req.logger.error(`Passport - Error al iniciar sesión: ${error}`);
            return done(error); 
        }
    }));

    passport.use('github', new GitHubStrategy({
        clientID: config.GITHUB_CLIENT_ID,
        clientSecret: config.GITHUB_CLIENT_SECRET,
        callbackURL: config.GITHUB_CALLBACK_URL
    }, async (accessToken, refreshToken, profile, done) => {
        try {
            let email = profile._json.email;
            if (!email) {
                const response = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        'Authorization': `token ${accessToken}`
                    }
                });
                const emails = await response.json();
                const primaryEmail = emails.find(email => email.primary && email.verified);
                email = primaryEmail ? primaryEmail.email : null;
            }
    
            if (!email) {
                return done(new Error('No se pudo obtener el correo electrónico del usuario.'));
            }
            let user = await userService.getUserByEmail(email);    
            // Si no existe, lo creamos
            if (!user) {
                let newUser = {
                    first_name: profile._json.name || profile.username,
                    last_name: ' ',
                    age: 18,
                    cart: await cartService.createCart(),
                    email: email,
                    password: '',  // No le asignamos contraseña
                    role: 'user'
                };
                let result = await userService.addUser(newUser);
                return done(null, result);
            } else {
                return done(null, user);
            }
        } catch (error) {
            return done(error);
        }
    }));
    
    passport.use('jwt', new JWTStrategy({
        jwtFromRequest: ExtractJWT.fromExtractors([cookieExtractor]),
        secretOrKey: 'severus23' //debe ser el mismo que en app.js/server.js
    }, async(jwt_payload, done) => {
        try {
            if(jwt_payload.email === admin.email){
                const adminUser = admin
                return done(null, adminUser);
            }
            return done(null, jwt_payload);
        } catch (error) {
            return done(error);
        }
    }))

    passport.serializeUser((user, done) => {
        done(null, user._id);
    });

    passport.deserializeUser( async(id, done) => {
        let user = await userService.getUserById(id);
        done(null, user);
    });
    
}

export default initializePassport;
