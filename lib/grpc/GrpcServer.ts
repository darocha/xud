import fs from 'fs';
import { hostname } from 'os';
import grpc, { Server } from 'grpc';
import { pki, md } from 'node-forge';
import assert from 'assert';
import Logger from '../Logger';
import GrpcService from './GrpcService';
import Service from '../service/Service';
import errors from './errors';
import { XudService } from '../proto/xudrpc_grpc_pb';
import { HashResolverService } from '../proto/lndrpc_grpc_pb';

class GrpcServer {
  private server: Server;

  constructor(private logger: Logger, service: Service) {
    this.server = new grpc.Server();

    const grpcService = new GrpcService(logger, service);
    this.server.addService(XudService, {
      addCurrency: grpcService.addCurrency,
      addPair: grpcService.addPair,
      removeOrder: grpcService.removeOrder,
      channelBalance: grpcService.channelBalance,
      connect: grpcService.connect,
      ban: grpcService.ban,
      unban: grpcService.unban,
      getInfo: grpcService.getInfo,
      getOrders: grpcService.getOrders,
      listCurrencies: grpcService.listCurrencies,
      listPairs: grpcService.listPairs,
      listPeers: grpcService.listPeers,
      placeOrder: grpcService.placeOrder,
      placeOrderSync: grpcService.placeOrderSync,
      removeCurrency: grpcService.removeCurrency,
      removePair: grpcService.removePair,
      shutdown: grpcService.shutdown,
      subscribeAddedOrders: grpcService.subscribeAddedOrders,
      subscribeRemovedOrders: grpcService.subscribeRemovedOrders,
      subscribeSwaps: grpcService.subscribeSwaps,
    });

    this.server.addService(HashResolverService, {
      resolveHash: grpcService.resolveHash,
    });
  }

  /**
   * Start the server and begin listening on the provided port
   * @returns true if the server started listening successfully, false otherwise
   */
  public listen = async (port: number, host: string, tlsCertPath: string, tlsKeyPath: string): Promise<boolean> => {
    assert(Number.isInteger(port) && port > 1023 && port < 65536, 'port must be an integer between 1024 and 65535');

    let certificate: Buffer;
    let privateKey: Buffer;

    if (!fs.existsSync(tlsCertPath) || !fs.existsSync(tlsKeyPath)) {
      this.logger.debug('Could not find gRPC TLS certificate. Generating new one');
      const { tlsCert, tlsKey } = this.generateCertificate(tlsCertPath, tlsKeyPath);

      certificate = Buffer.from(tlsCert);
      privateKey = Buffer.from(tlsKey);
    } else {
      certificate = fs.readFileSync(tlsCertPath);
      privateKey = fs.readFileSync(tlsKeyPath);
    }

    // tslint:disable-next-line:no-null-keyword
    const credentials = grpc.ServerCredentials.createSsl(null,
      [{
        cert_chain: certificate,
        private_key: privateKey,
      }], false);

    const bindCode = this.server.bind(`${host}:${port}`, credentials);
    if (bindCode !== port) {
      const error = errors.COULD_NOT_BIND(port.toString());
      this.logger.error(error.message);
      return false;
    }

    this.server.start();
    this.logger.info(`gRPC server listening on ${host}:${port}`);
    return true;
  }

  /**
   * Stop listening for requests
   */
  public close = (): Promise<void> => {
    return new Promise((resolve) => {
      this.server.tryShutdown(() => {
        this.logger.info('GRPC server completed shutdown');
        resolve();
      });
    });
  }

  /**
   * Generate a new certificate and save it to the disk
   * @returns the cerificate and its private key
   */
  private generateCertificate = (tlsCertPath: string, tlsKeyPath: string): { tlsCert: string, tlsKey: string } => {
    const keys = pki.rsa.generateKeyPair(1024);
    const cert = pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = String(Math.floor(Math.random() * 1024) + 1);

    // TODO: handle expired certificates
    const date = new Date();
    cert.validity.notBefore = date;
    cert.validity.notAfter = new Date(date.getFullYear() + 5, date.getMonth(), date.getDay());

    const attributes = [
      {
        name: 'organizationName',
        value: 'XUD autogenerated certificate',
      },
      {
        name: 'commonName',
        value: hostname(),
      },
    ];

    cert.setSubject(attributes);
    cert.setIssuer(attributes);

    // TODO: add tlsextradomain and tlsextraip options
    cert.setExtensions([
      {
        name: 'subjectAltName',
        altNames: [
          {
            type: 2,
            value: 'localhost',
          },
          {
            type: 7,
            ip: '127.0.0.1',
          },
        ],
      },
    ]);

    cert.sign(keys.privateKey, md.sha256.create());

    const certificate = pki.certificateToPem(cert);
    const privateKey = pki.privateKeyToPem(keys.privateKey);

    fs.writeFileSync(tlsCertPath, certificate);
    fs.writeFileSync(tlsKeyPath, privateKey);

    return {
      tlsCert: certificate,
      tlsKey: privateKey,
    };
  }
}

export default GrpcServer;
