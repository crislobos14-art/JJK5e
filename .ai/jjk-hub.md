# Diseño de JJK Hub

El [protocolo del equipo](equipo.md) describe el flujo vigente entre las tres sesiones y GitHub. El prototipo de este documento explora un futuro relevo mediante APIs.

## Agentes de API

Una persona inicia la solicitud sobre un Issue. El servicio valida al solicitante y recupera contexto acotado del Issue o PR. OpenAI genera una propuesta y Anthropic recibe el contexto y la propuesta para revisarla una vez. El servicio devuelve ambos resultados a la persona solicitante. Cada ejecución registra el Issue y, cuando procede, el commit consultado.

Los agentes usan credenciales de API propias del servicio y tienen su propia facturación. Las conversaciones personales de ChatGPT y Claude quedan en sus respectivas cuentas. El contexto compartido con el Hub se proporciona explícitamente.

## Permisos y gasto

- Primera versión con lectura de contenido, Issues y PR en GitHub. Si hace falta autenticación, instalad una GitHub App limitada a este repositorio y con esos permisos de lectura. Una persona lleva al PR cualquier propuesta que decida adoptar.
- Guardad claves de proyecto dedicadas de OpenAI y Anthropic en el almacén de secretos del alojamiento. Registrad identificadores, consumo y errores sanitizados.
- Acordad el presupuesto antes de activar llamadas reales. Aplicad una llamada por proveedor y solicitud, modelos permitidos, topes de entrada y salida y una tarea activa por repositorio. Reservad de forma atómica el coste máximo estimado antes de llamar, reconciliadlo con el uso devuelto y retened la reserva si la facturación es incierta. Aplicad topes diarios y mensuales en el Hub.
- Tratad el contenido de GitHub y las respuestas de los modelos como datos. Limitad las acciones del servicio a leer el contexto autorizado y devolver el resultado. Descartad entregas duplicadas y aplicad los mismos límites a los reintentos manuales.

## Activación

Primero probad el relevo con respuestas simuladas. Verificad el rechazo de usuarios no autorizados, entregas duplicadas y solicitudes que excedan el presupuesto. Cuando estén listos esos controles y se acuerde el presupuesto, probad una solicitud real sobre un Issue público y comprobad el gasto registrado.

### Demostración local

Desde la raíz del repositorio, ejecutad `node tools/jjk-hub/demo.mjs`. Veréis cómo la propuesta y los datos del Issue de ejemplo pasan al revisor. Las dos respuestas son simuladas y el comando funciona sin red ni credenciales.

La prueba `node --test tests/jjk-hub.test.mjs` verifica el contenido del relevo, el tope de contexto y que una propuesta incompleta detiene la revisión. Para activar el servicio quedan por integrar la lectura de Issues y PR, el control de acceso y la reserva de presupuesto.
